//! The child receives a short-lived, Responses-only credential; the RIFT key stays here.
use serde_json::Value;
use std::{path::Path, time::Duration};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::{JoinHandle, JoinSet};

pub struct Relay {
    pub port: u16,
    pub nonce: String,
    pub config: Value,
    task: JoinHandle<()>,
}
impl Relay {
    pub fn abort_handle(&self) -> tokio::task::AbortHandle {
        self.task.abort_handle()
    }
}
impl Drop for Relay {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub async fn start(home: &Path, origin: &str, owner: &str) -> Result<Relay, String> {
    let login: Value = serde_json::from_slice(
        &std::fs::read(home.join(".config/rift/console.json")).map_err(|_| {
            "Connect this RIFT account with rift login before opening native console."
        })?,
    )
    .map_err(|_| "Invalid RIFT console login. Run rift login again.")?;
    let login_origin = login["app"].as_str().unwrap_or("").trim_end_matches('/');
    if login_origin != origin {
        return Err(
            "RIFT console login belongs to another server. Reconnect with rift login for this app."
                .into(),
        );
    }
    let key = login["apiKey"]
        .as_str()
        .filter(|s| s.starts_with("rift_live_") && s.len() < 512)
        .ok_or("RIFT console login is missing. Run rift login.")?
        .to_owned();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|_| "Could not start RIFT model connection.")?;
    let response = client
        .get(format!("{origin}/api/console/native/config"))
        .bearer_auth(&key)
        .send()
        .await
        .map_err(|_| "RIFT model service is unreachable.")?;
    if !response.status().is_success() {
        return Err(format!(
            "RIFT native model service is unavailable ({}). Check account and credit eligibility.",
            response.status().as_u16()
        ));
    }
    let config: Value = response
        .json()
        .await
        .map_err(|_| "Invalid native model configuration.")?;
    if config["ownerId"].as_str() != Some(owner) {
        return Err("The console login belongs to another RIFT account. Run rift login with the current account.".into());
    }
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| "Could not bind native model relay.")?;
    let port = listener
        .local_addr()
        .map_err(|_| "Could not read native model port.")?
        .port();
    let nonce = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let token = nonce.clone();
    let endpoint = format!("{origin}/api/console/native/responses");
    let task = tokio::spawn(async move {
        let mut requests = JoinSet::new();
        loop {
            tokio::select! {
                accepted = listener.accept() => {
                    let Ok((socket, _)) = accepted else { break };
                    let (client, key, token, endpoint) = (client.clone(), key.clone(), token.clone(), endpoint.clone());
                    if requests.len() >= 8 { drop(socket); continue; }
                    requests.spawn(async move {
                        let _ = tokio::time::timeout(Duration::from_secs(300), forward(socket, client, &key, &token, &endpoint)).await;
                    });
                }
                _ = requests.join_next(), if !requests.is_empty() => {}
            }
        }
    });
    // Keep Tokio's abort handle; dropping Relay revokes listener and all in-flight requests.
    Ok(Relay {
        port,
        nonce,
        config,
        task,
    })
}

fn parse_headers(header: &str, nonce: &str) -> Result<usize, ()> {
    let mut lines = header.split("\r\n");
    if lines.next() != Some("POST /responses HTTP/1.1") {
        return Err(());
    }
    let mut authorized = false;
    let mut length = None;
    for line in lines.filter(|line| !line.is_empty()) {
        let (name, value) = line.split_once(':').ok_or(())?;
        let value = value.trim();
        if name.eq_ignore_ascii_case("authorization") {
            if authorized || value != format!("Bearer {nonce}") {
                return Err(());
            }
            authorized = true;
        } else if name.eq_ignore_ascii_case("content-length") {
            if length.is_some() {
                return Err(());
            }
            length = Some(value.parse::<usize>().map_err(|_| ())?);
        } else if name.eq_ignore_ascii_case("transfer-encoding")
            || name.eq_ignore_ascii_case("origin")
            || name.eq_ignore_ascii_case("content-encoding")
        {
            return Err(());
        }
    }
    let length = length
        .filter(|n| *n > 0 && *n <= 20 * 1024 * 1024)
        .ok_or(())?;
    if !authorized {
        return Err(());
    }
    Ok(length)
}

async fn forward(
    mut socket: TcpStream,
    client: reqwest::Client,
    key: &str,
    nonce: &str,
    endpoint: &str,
) -> Result<(), ()> {
    let mut input = Vec::new();
    let boundary = loop {
        let mut chunk = [0; 4096];
        let n = socket.read(&mut chunk).await.map_err(|_| ())?;
        if n == 0 {
            return Err(());
        }
        input.extend_from_slice(&chunk[..n]);
        if let Some(offset) = input.windows(4).position(|s| s == b"\r\n\r\n") {
            break offset + 4;
        }
        if input.len() > 16384 {
            return Err(());
        }
    };
    if boundary > 16384 {
        return Err(());
    }
    let length = match std::str::from_utf8(&input[..boundary])
        .ok()
        .and_then(|h| parse_headers(h, nonce).ok())
    {
        Some(n) => n,
        None => {
            let _ = socket
                .write_all(
                    b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await;
            return Err(());
        }
    };
    if input.len() - boundary > length {
        return Err(());
    }
    let mut body = input.split_off(boundary);
    let received = body.len();
    body.resize(length, 0);
    socket
        .read_exact(&mut body[received..])
        .await
        .map_err(|_| ())?;
    let mut response = client
        .post(endpoint)
        .bearer_auth(key)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|_| ())?;
    let header = format!("HTTP/1.1 {} Response\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n", response.status().as_u16());
    socket.write_all(header.as_bytes()).await.map_err(|_| ())?;
    while let Some(chunk) = response.chunk().await.map_err(|_| ())? {
        if chunk.is_empty() {
            continue;
        }
        socket
            .write_all(format!("{:x}\r\n", chunk.len()).as_bytes())
            .await
            .map_err(|_| ())?;
        socket.write_all(&chunk).await.map_err(|_| ())?;
        socket.write_all(b"\r\n").await.map_err(|_| ())?;
    }
    socket.write_all(b"0\r\n\r\n").await.map_err(|_| ())?;
    Ok(())
}

#[cfg(test)]
#[path = "native_codex_relay_tests.rs"]
mod tests;
