mod browser;
mod file_access;
mod local_access;
mod computer_access;
mod consent;
mod platform;
mod pty;
mod native_codex;
mod native_codex_relay;
mod native_codex_process;
mod window_chrome;

#[cfg(debug_assertions)]
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU16, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use tokio::io::AsyncReadExt;
#[cfg(debug_assertions)]
use tokio::io::AsyncWriteExt;

const DESKTOP_AUTH_STATE_TTL: Duration = Duration::from_secs(5 * 60);
const MAX_PENDING_DESKTOP_AUTH_STATES: usize = 16;

/// Port for the local dev auth callback server (0 = not started)
static DEV_AUTH_PORT: AtomicU16 = AtomicU16::new(0);

/// Port for the command execution server (0 = not started)
static CMD_SERVER_PORT: AtomicU16 = AtomicU16::new(0);

/// Session token for authenticating command server requests
static CMD_SERVER_TOKEN: std::sync::OnceLock<String> = std::sync::OnceLock::new();

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum DesktopTheme {
    Light,
    Dark,
    System,
}

fn desktop_theme_for_caller(label: &str, theme: DesktopTheme) -> Result<Option<tauri::Theme>, String> {
    if label != "main" {
        return Err("Only the RIFT interface can change window appearance.".into());
    }
    Ok(match theme {
        DesktopTheme::Light => Some(tauri::Theme::Light),
        DesktopTheme::Dark => Some(tauri::Theme::Dark),
        DesktopTheme::System => None,
    })
}

#[tauri::command]
fn set_desktop_theme(webview: tauri::Webview, theme: DesktopTheme) -> Result<(), String> {
    let theme = desktop_theme_for_caller(webview.label(), theme)?;
    webview.window().set_theme(theme).map_err(|_| "Could not change window appearance.".into())
}

#[derive(Clone, Serialize)]
struct DesktopMenuAction {
    action: &'static str,
}

struct PendingDesktopAuthStates(std::sync::Mutex<HashMap<String, SystemTime>>);

fn generate_desktop_auth_state() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

fn prune_expired_auth_states(states: &mut HashMap<String, SystemTime>, now: SystemTime) {
    states.retain(|_, expires_at| *expires_at > now);
    while states.len() >= MAX_PENDING_DESKTOP_AUTH_STATES {
        if let Some(oldest_key) = states
            .iter()
            .min_by_key(|(_, expires_at)| *expires_at)
            .map(|(state, _)| state.clone())
        {
            states.remove(&oldest_key);
        } else {
            break;
        }
    }
}

/// Get the dev auth callback port (0 if not running in dev mode)
#[tauri::command]
fn get_dev_auth_port() -> u16 {
    DEV_AUTH_PORT.load(Ordering::Relaxed)
}

#[tauri::command]
fn prepare_desktop_auth_state(
    pending_states: tauri::State<'_, PendingDesktopAuthStates>,
) -> Result<String, String> {
    let state = generate_desktop_auth_state();
    let now = SystemTime::now();
    let expires_at = now + DESKTOP_AUTH_STATE_TTL;
    let mut states = pending_states
        .0
        .lock()
        .map_err(|_| "desktop auth state lock poisoned".to_string())?;
    prune_expired_auth_states(&mut states, now);
    states.insert(state.clone(), expires_at);
    Ok(state)
}

/// Get the command server port, session token, and OS info
#[tauri::command]
fn get_cmd_server_info() -> CmdServerInfo {
    CmdServerInfo {
        port: CMD_SERVER_PORT.load(Ordering::Relaxed),
        token: CMD_SERVER_TOKEN.get().cloned().unwrap_or_default(),
    }
}

#[derive(Serialize)]
struct CmdServerInfo {
    port: u16,
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalFileMetadata {
    path: String,
    name: String,
    media_type: String,
    size: u64,
    last_modified: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalFileData {
    path: String,
    name: String,
    media_type: String,
    size: u64,
    last_modified: u64,
    base64: String,
}

#[cfg(debug_assertions)]
fn json_error_body(message: &str) -> String {
    serde_json::to_string(&serde_json::json!({ "error": message }))
        .unwrap_or_else(|_| r#"{"error":"serialization failed"}"#.to_string())
}

#[cfg(debug_assertions)]
fn json_stream_error_line(message: &str) -> String {
    serde_json::to_string(&serde_json::json!({
        "type": "error",
        "message": message,
    }))
    .unwrap_or_else(|_| r#"{"type":"error","message":"serialization failed"}"#.to_string())
}

fn guess_media_type(path: &std::path::Path) -> String {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        "md" | "markdown" => "text/markdown",
        "csv" => "text/csv",
        "json" => "application/json",
        "html" | "htm" => "text/html",
        "js" | "mjs" | "cjs" => "text/javascript",
        "ts" | "tsx" => "text/typescript",
        "css" => "text/css",
        "xml" => "application/xml",
        "zip" => "application/zip",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        _ => "application/octet-stream",
    }
    .to_string()
}

#[tauri::command]
fn get_local_file_metadata(path: String) -> Result<LocalFileMetadata, String> {
    let path_buf = PathBuf::from(&path);
    let metadata = fs::metadata(&path_buf).map_err(|e| format!("Metadata error: {}", e))?;
    if !metadata.is_file() {
        return Err("Selected path is not a file".to_string());
    }

    let name = path_buf
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file")
        .to_string();
    let last_modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);

    Ok(LocalFileMetadata {
        path,
        name,
        media_type: guess_media_type(&path_buf),
        size: metadata.len(),
        last_modified,
    })
}

#[tauri::command]
fn read_local_file(path: String) -> Result<LocalFileData, String> {
    use base64::Engine;

    let metadata = get_local_file_metadata(path.clone())?;
    let bytes = fs::read(&path).map_err(|e| format!("Read error: {}", e))?;

    Ok(LocalFileData {
        path: metadata.path,
        name: metadata.name,
        media_type: metadata.media_type,
        size: metadata.size,
        last_modified: metadata.last_modified,
        base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

// ── Command Execution Server ──────────────────────────────────────────

#[cfg(debug_assertions)]
#[derive(Deserialize)]
struct ExecRequest {
    command: String,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    #[serde(default = "default_timeout")]
    timeout_ms: u64,
}

#[cfg(debug_assertions)]
fn default_timeout() -> u64 {
    30000
}

#[derive(Serialize)]
struct ExecResponse {
    stdout: String,
    stderr: String,
    exit_code: i32,
}

async fn wait_with_output_or_kill_on_timeout(
    mut child: tokio::process::Child,
    timeout: Duration,
    timeout_ms: u64,
) -> Result<std::process::Output, String> {
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture stdout".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture stderr".to_string())?;
    let child_pid = child.id();
    let started_at = tokio::time::Instant::now();

    let stdout_task = tokio::spawn(async move {
        let mut output = Vec::new();
        stdout.read_to_end(&mut output).await.map(|_| output)
    });
    let stderr_task = tokio::spawn(async move {
        let mut output = Vec::new();
        stderr.read_to_end(&mut output).await.map(|_| output)
    });

    let status = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => status,
        Ok(Err(e)) => {
            stdout_task.abort();
            stderr_task.abort();
            return Err(format!("Process error: {}", e));
        }
        Err(_) => {
            platform::graceful_kill(&mut child).await;
            stdout_task.abort();
            stderr_task.abort();
            return Err(format!("Command timed out after {}ms", timeout_ms));
        }
    };

    let stdout_abort = stdout_task.abort_handle();
    let stderr_abort = stderr_task.abort_handle();
    let remaining = timeout
        .checked_sub(started_at.elapsed())
        .unwrap_or_else(|| Duration::from_millis(0));
    let drain_timeout = if remaining.is_zero() {
        Duration::from_millis(1)
    } else {
        remaining
    };

    let drain_result = tokio::time::timeout(drain_timeout, async {
        let stdout = match stdout_task.await {
            Ok(Ok(output)) => output,
            _ => Vec::new(),
        };
        let stderr = match stderr_task.await {
            Ok(Ok(output)) => output,
            _ => Vec::new(),
        };
        (stdout, stderr)
    })
    .await;

    let (stdout, stderr) = match drain_result {
        Ok(output) => output,
        Err(_) => {
            if let Some(pid) = child_pid {
                platform::cancel_process_tree(pid).await;
            }
            stdout_abort.abort();
            stderr_abort.abort();
            return Err(format!("Command timed out after {}ms", timeout_ms));
        }
    };

    Ok(std::process::Output {
        status,
        stdout,
        stderr,
    })
}

#[cfg(debug_assertions)]
#[derive(Deserialize)]
struct FileReadRequest {
    path: String,
}

#[cfg(debug_assertions)]
#[derive(Deserialize)]
struct FileWriteRequest {
    path: String,
    content: String,
    #[serde(default)]
    is_base64: bool,
}

#[cfg(debug_assertions)]
#[derive(Deserialize)]
struct FileRemoveRequest {
    path: String,
}

#[cfg(debug_assertions)]
#[derive(Deserialize)]
struct FileListRequest {
    path: String,
}

/// Start the local command execution HTTP server.
/// Binds to 127.0.0.1 only and requires a session token for all requests.
#[cfg(debug_assertions)]
async fn start_cmd_server() {
    // Generate a random session token
    let token = uuid::Uuid::new_v4().to_string();
    let _ = CMD_SERVER_TOKEN.set(token.clone());

    let listener = match tokio::net::TcpListener::bind("127.0.0.1:0").await {
        Ok(l) => l,
        Err(e) => {
            log::error!("Failed to start command server: {}", e);
            return;
        }
    };

    let port = match listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(e) => {
            log::error!("Failed to get command server address: {}", e);
            return;
        }
    };
    CMD_SERVER_PORT.store(port, Ordering::Relaxed);
    log::info!("Command server listening on http://127.0.0.1:{}", port);

    loop {
        let (stream, addr) = match listener.accept().await {
            Ok(conn) => conn,
            Err(e) => {
                log::warn!("Command server accept error: {}", e);
                continue;
            }
        };

        // Only accept connections from localhost
        if !addr.ip().is_loopback() {
            log::warn!("Rejected non-loopback connection from {}", addr);
            continue;
        }

        let token = token.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_cmd_request(stream, &token).await {
                log::warn!("Command server request error: {}", e);
            }
        });
    }
}

/// Maximum allowed header size (256KB). Requests with headers exceeding this are rejected.
#[cfg(debug_assertions)]
const MAX_HEADER_SIZE: usize = 256 * 1024;

/// Maximum allowed body size (10MB). Requests with bodies exceeding this are rejected.
#[cfg(debug_assertions)]
const MAX_BODY_SIZE: usize = 10 * 1024 * 1024;

/// Parse an HTTP request from the stream, returning (method, path, headers, body)
#[cfg(debug_assertions)]
async fn parse_http_request(
    stream: &mut tokio::net::TcpStream,
) -> Result<(String, String, HashMap<String, String>, String), String> {
    let mut buf = vec![0u8; 64 * 1024]; // 64KB initial buffer
    let mut total_read = 0;

    // Read headers first (with size cap to prevent OOM)
    loop {
        let n = stream
            .read(&mut buf[total_read..])
            .await
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("Connection closed".into());
        }
        total_read += n;

        // Check if we have the full headers (search in bytes, not string)
        if buf[..total_read].windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }

        // Reject oversized headers
        if total_read > MAX_HEADER_SIZE {
            return Err("Request headers too large".into());
        }

        // Grow buffer if needed (up to the cap)
        if total_read >= buf.len() {
            let new_size = (buf.len() * 2).min(MAX_HEADER_SIZE + 1);
            if new_size <= buf.len() {
                return Err("Request headers too large".into());
            }
            buf.resize(new_size, 0);
        }
    }

    // Find header/body boundary in raw bytes to avoid string/byte index mismatch
    let header_end = buf[..total_read]
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or("No header end")?;
    let body_start_idx = header_end + 4;

    let header_section = String::from_utf8_lossy(&buf[..header_end]).to_string();

    // Parse request line
    let first_line = header_section.lines().next().ok_or("Empty request")?;
    let parts: Vec<&str> = first_line.split_whitespace().collect();
    if parts.len() < 2 {
        return Err("Invalid request line".into());
    }
    let method = parts[0].to_string();
    let path = parts[1].to_string();

    // Parse headers
    let mut headers = HashMap::new();
    for line in header_section.lines().skip(1) {
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_lowercase(), value.trim().to_string());
        }
    }

    // Read body based on content-length
    let content_length: usize = headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    if content_length > MAX_BODY_SIZE {
        return Err("Request body too large".into());
    }

    let body_bytes_read = total_read - body_start_idx;
    let mut body_buf = buf[body_start_idx..total_read].to_vec();

    // Read remaining body if needed
    if body_bytes_read < content_length {
        let remaining = content_length - body_bytes_read;
        let mut remaining_buf = vec![0u8; remaining];
        let mut read_so_far = 0;
        while read_so_far < remaining {
            let n = stream
                .read(&mut remaining_buf[read_so_far..])
                .await
                .map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            read_so_far += n;
        }
        body_buf.extend_from_slice(&remaining_buf[..read_so_far]);
    }

    let body = String::from_utf8_lossy(&body_buf[..content_length.min(body_buf.len())]).to_string();

    Ok((method, path, headers, body))
}

#[cfg(debug_assertions)]
async fn handle_cmd_request(
    mut stream: tokio::net::TcpStream,
    expected_token: &str,
) -> Result<(), String> {
    let (method, path, headers, body) = parse_http_request(&mut stream).await?;

    // CORS preflight
    if method == "OPTIONS" {
        let response = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nAccess-Control-Max-Age: 86400\r\n\r\n";
        stream
            .write_all(response.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Validate auth token
    let auth_header = headers.get("authorization").cloned().unwrap_or_default();
    let provided_token = auth_header.strip_prefix("Bearer ").unwrap_or("");
    if provided_token != expected_token {
        let body = r#"{"error":"unauthorized"}"#;
        let response = format!(
            "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\n\r\n{}",
            body.len(), body
        );
        stream
            .write_all(response.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Streaming execute gets special handling (writes directly to stream)
    if method == "POST" && path == "/execute/stream" {
        return handle_execute_stream(&body, &mut stream).await;
    }

    let (route_path, _query_string) = if let Some(idx) = path.find('?') {
        (&path[..idx], &path[idx + 1..])
    } else {
        (path.as_str(), "")
    };

    let result = match (method.as_str(), route_path) {
        ("POST", "/execute") => handle_execute(&body).await,
        ("POST", "/files/read") => handle_file_read(&body).await,
        ("POST", "/files/write") => handle_file_write(&body).await,
        ("POST", "/files/remove") => handle_file_remove(&body).await,
        ("POST", "/files/list") => handle_file_list(&body).await,
        (_, "/health") => Ok(r#"{"status":"ok"}"#.to_string()),
        _ => Err("not found".to_string()),
    };

    let (status, resp_body) = match result {
        Ok(json) => ("200 OK", json),
        Err(e) if e == "not found" => ("404 Not Found", json_error_body("not found")),
        Err(e) => ("500 Internal Server Error", json_error_body(&e)),
    };

    let response = format!(
        "HTTP/1.1 {}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\n\r\n{}",
        status, resp_body.len(), resp_body
    );
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(debug_assertions)]
async fn handle_execute(body: &str) -> Result<String, String> {
    let req: ExecRequest =
        serde_json::from_str(body).map_err(|e| format!("Invalid JSON: {}", e))?;

    let mut cmd = platform::build_command(&req.command, req.cwd.as_deref(), req.env.as_ref());

    let child = cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))?;

    let timeout = Duration::from_millis(req.timeout_ms);
    let output = wait_with_output_or_kill_on_timeout(child, timeout, req.timeout_ms).await?;

    // Truncate output to 1MB to prevent huge responses
    const MAX_OUTPUT: usize = 1024 * 1024;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout_str = if stdout.len() > MAX_OUTPUT {
        format!(
            "{}... [truncated, {} total bytes]",
            &stdout[..MAX_OUTPUT],
            stdout.len()
        )
    } else {
        stdout.to_string()
    };
    let stderr_str = if stderr.len() > MAX_OUTPUT {
        format!(
            "{}... [truncated, {} total bytes]",
            &stderr[..MAX_OUTPUT],
            stderr.len()
        )
    } else {
        stderr.to_string()
    };

    let resp = ExecResponse {
        stdout: stdout_str,
        stderr: stderr_str,
        exit_code: output.status.code().unwrap_or(-1),
    };

    serde_json::to_string(&resp).map_err(|e| format!("Serialize error: {}", e))
}

/// Streaming execute: sends NDJSON lines as stdout/stderr arrive, then a final
/// line with exit_code. Each line is one of:
///   {"type":"stdout","data":"..."}
///   {"type":"stderr","data":"..."}
///   {"type":"exit","exit_code":0}
///   {"type":"error","message":"..."}
#[cfg(debug_assertions)]
async fn handle_execute_stream(
    body: &str,
    stream: &mut tokio::net::TcpStream,
) -> Result<(), String> {
    let req: ExecRequest =
        serde_json::from_str(body).map_err(|e| format!("Invalid JSON: {}", e))?;

    let mut cmd = platform::build_command(&req.command, req.cwd.as_deref(), req.env.as_ref());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let err_body = json_error_body(&format!("Failed to spawn: {}", e));
            let resp = format!(
                "HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\n\r\n{}",
                err_body.len(), err_body
            );
            let _ = stream.write_all(resp.as_bytes()).await;
            return Ok(());
        }
    };

    // Send chunked response headers
    let headers = "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nAccess-Control-Allow-Origin: *\r\nTransfer-Encoding: chunked\r\n\r\n";
    stream
        .write_all(headers.as_bytes())
        .await
        .map_err(|e| e.to_string())?;

    let timeout = Duration::from_millis(req.timeout_ms);
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();

    let result = tokio::time::timeout(timeout, async {
        let mut stdout_buf = [0u8; 4096];
        let mut stderr_buf = [0u8; 4096];
        let mut stdout_done = false;
        let mut stderr_done = false;

        loop {
            if stdout_done && stderr_done {
                break;
            }

            tokio::select! {
                result = stdout.read(&mut stdout_buf), if !stdout_done => {
                    match result {
                        Ok(0) => stdout_done = true,
                        Ok(n) => {
                            let text = String::from_utf8_lossy(&stdout_buf[..n]);
                            let escaped = serde_json::to_string(&text).unwrap_or_default();
                            let line = format!(r#"{{"type":"stdout","data":{}}}"#, escaped);
                            write_chunk(stream, &line).await;
                        }
                        Err(_) => stdout_done = true,
                    }
                }
                result = stderr.read(&mut stderr_buf), if !stderr_done => {
                    match result {
                        Ok(0) => stderr_done = true,
                        Ok(n) => {
                            let text = String::from_utf8_lossy(&stderr_buf[..n]);
                            let escaped = serde_json::to_string(&text).unwrap_or_default();
                            let line = format!(r#"{{"type":"stderr","data":{}}}"#, escaped);
                            write_chunk(stream, &line).await;
                        }
                        Err(_) => stderr_done = true,
                    }
                }
            }
        }

        // Wait for process to exit
        child.wait().await
    })
    .await;

    match result {
        Ok(Ok(status)) => {
            let line = format!(
                r#"{{"type":"exit","exit_code":{}}}"#,
                status.code().unwrap_or(-1)
            );
            write_chunk(stream, &line).await;
        }
        Ok(Err(e)) => {
            let line = json_stream_error_line(&format!("Process error: {}", e));
            write_chunk(stream, &line).await;
        }
        Err(_) => {
            // Timeout — gracefully kill the process
            platform::graceful_kill(&mut child).await;
            let line =
                json_stream_error_line(&format!("Command timed out after {}ms", req.timeout_ms));
            write_chunk(stream, &line).await;
        }
    }

    // Terminal chunk
    write_chunk(stream, "").await;
    Ok(())
}

/// Write a single HTTP chunked-transfer chunk
#[cfg(debug_assertions)]
async fn write_chunk(stream: &mut tokio::net::TcpStream, data: &str) {
    let payload = if data.is_empty() {
        "0\r\n\r\n".to_string()
    } else {
        let line = format!("{}\n", data);
        format!("{:x}\r\n{}\r\n", line.len(), line)
    };
    let _ = stream.write_all(payload.as_bytes()).await;
    let _ = stream.flush().await;
}

#[cfg(debug_assertions)]
async fn handle_file_read(body: &str) -> Result<String, String> {
    let req: FileReadRequest =
        serde_json::from_str(body).map_err(|e| format!("Invalid JSON: {}", e))?;
    let content = tokio::fs::read_to_string(&req.path)
        .await
        .map_err(|e| format!("Read error: {}", e))?;
    serde_json::to_string(&serde_json::json!({ "content": content })).map_err(|e| e.to_string())
}

#[cfg(debug_assertions)]
async fn handle_file_write(body: &str) -> Result<String, String> {
    let req: FileWriteRequest =
        serde_json::from_str(body).map_err(|e| format!("Invalid JSON: {}", e))?;

    // Ensure parent directory exists
    if let Some(parent) = std::path::Path::new(&req.path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Mkdir error: {}", e))?;
    }

    if req.is_base64 {
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&req.content)
            .map_err(|e| format!("Base64 decode error: {}", e))?;
        tokio::fs::write(&req.path, bytes)
            .await
            .map_err(|e| format!("Write error: {}", e))?;
    } else {
        tokio::fs::write(&req.path, &req.content)
            .await
            .map_err(|e| format!("Write error: {}", e))?;
    }

    Ok(r#"{"ok":true}"#.to_string())
}

#[cfg(debug_assertions)]
async fn handle_file_remove(body: &str) -> Result<String, String> {
    let req: FileRemoveRequest =
        serde_json::from_str(body).map_err(|e| format!("Invalid JSON: {}", e))?;
    let path = std::path::Path::new(&req.path);

    if path.is_dir() {
        tokio::fs::remove_dir_all(path)
            .await
            .map_err(|e| format!("Remove error: {}", e))?;
    } else {
        tokio::fs::remove_file(path)
            .await
            .map_err(|e| format!("Remove error: {}", e))?;
    }

    Ok(r#"{"ok":true}"#.to_string())
}

#[cfg(debug_assertions)]
async fn handle_file_list(body: &str) -> Result<String, String> {
    let req: FileListRequest =
        serde_json::from_str(body).map_err(|e| format!("Invalid JSON: {}", e))?;
    let mut entries = Vec::new();
    let mut dir = tokio::fs::read_dir(&req.path)
        .await
        .map_err(|e| format!("ReadDir error: {}", e))?;

    while let Some(entry) = dir
        .next_entry()
        .await
        .map_err(|e| format!("Entry error: {}", e))?
    {
        let name = entry.file_name().to_string_lossy().to_string();
        entries.push(serde_json::json!({ "name": name }));
    }

    serde_json::to_string(&entries).map_err(|e| e.to_string())
}

// ── Tauri IPC Commands ────────────────────────────────────────────────

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
enum StreamEvent {
    Stdout {
        data: String,
    },
    Stderr {
        data: String,
    },
    Exit {
        // Explicit rename needed: Tauri 2's Channel<T> does not apply
        // rename_all to fields inside internally-tagged enum variants.
        #[serde(rename = "exitCode")]
        exit_code: i32,
    },
    Error {
        message: String,
    },
}

type StreamCommandState = std::sync::Arc<std::sync::Mutex<HashMap<String, u32>>>;

#[tauri::command]
async fn execute_command(
    command: String,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    timeout_ms: Option<u64>,
) -> Result<ExecResponse, String> {
    let mut cmd = platform::build_command(&command, cwd.as_deref(), env.as_ref());
    let child = cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))?;
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(30000));
    let timeout_ms = timeout_ms.unwrap_or(30000);
    let output = wait_with_output_or_kill_on_timeout(child, timeout, timeout_ms).await?;
    const MAX_OUTPUT: usize = 1024 * 1024;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout_str = if stdout.len() > MAX_OUTPUT {
        format!(
            "{}... [truncated, {} total bytes]",
            &stdout[..MAX_OUTPUT],
            stdout.len()
        )
    } else {
        stdout.to_string()
    };
    let stderr_str = if stderr.len() > MAX_OUTPUT {
        format!(
            "{}... [truncated, {} total bytes]",
            &stderr[..MAX_OUTPUT],
            stderr.len()
        )
    } else {
        stderr.to_string()
    };
    Ok(ExecResponse {
        stdout: stdout_str,
        stderr: stderr_str,
        exit_code: output.status.code().unwrap_or(-1),
    })
}

#[tauri::command]
async fn execute_stream_command(
    state: tauri::State<'_, StreamCommandState>,
    command_id: String,
    command: String,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    timeout_ms: Option<u64>,
    on_event: tauri::ipc::Channel<StreamEvent>,
) -> Result<(), String> {
    let mut cmd = platform::build_command(&command, cwd.as_deref(), env.as_ref());
    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))?;
    if let Some(pid) = child.id() {
        if let Ok(mut commands) = state.lock() {
            commands.insert(command_id.clone(), pid);
        }
    }
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(30000));
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();

    let result = tokio::time::timeout(timeout, async {
        let mut stdout_buf = [0u8; 4096];
        let mut stderr_buf = [0u8; 4096];
        let mut stdout_done = false;
        let mut stderr_done = false;

        loop {
            if stdout_done && stderr_done {
                break;
            }
            tokio::select! {
                result = stdout.read(&mut stdout_buf), if !stdout_done => {
                    match result {
                        Ok(0) => stdout_done = true,
                        Ok(n) => {
                            let data = String::from_utf8_lossy(&stdout_buf[..n]).to_string();
                            let _ = on_event.send(StreamEvent::Stdout { data });
                        }
                        Err(_) => stdout_done = true,
                    }
                }
                result = stderr.read(&mut stderr_buf), if !stderr_done => {
                    match result {
                        Ok(0) => stderr_done = true,
                        Ok(n) => {
                            let data = String::from_utf8_lossy(&stderr_buf[..n]).to_string();
                            let _ = on_event.send(StreamEvent::Stderr { data });
                        }
                        Err(_) => stderr_done = true,
                    }
                }
            }
        }
        child.wait().await
    })
    .await;

    match result {
        Ok(Ok(status)) => {
            let _ = on_event.send(StreamEvent::Exit {
                exit_code: status.code().unwrap_or(-1),
            });
        }
        Ok(Err(e)) => {
            let _ = on_event.send(StreamEvent::Error {
                message: format!("Process error: {}", e),
            });
        }
        Err(_) => {
            platform::graceful_kill(&mut child).await;
            let _ = on_event.send(StreamEvent::Error {
                message: format!("Command timed out after {}ms", timeout_ms.unwrap_or(30000)),
            });
        }
    }
    if let Ok(mut commands) = state.lock() {
        commands.remove(&command_id);
    }
    Ok(())
}

#[tauri::command]
async fn cancel_stream_command(
    state: tauri::State<'_, StreamCommandState>,
    command_id: String,
) -> Result<bool, String> {
    let pid = state
        .lock()
        .map_err(|_| "stream command state lock poisoned".to_string())?
        .get(&command_id)
        .copied();

    if let Some(pid) = pid {
        platform::cancel_process_tree(pid).await;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Start a local HTTP server for dev mode auth callbacks.
/// This replaces deep links which don't work in `tauri dev` on macOS.
/// Only compiled in debug builds — matches the cfg-gated call site at the
/// bottom of `run()`. Without this gate, release builds error out with
/// `dead_code` under `actions-rust-lang/setup-rust-toolchain@v1`'s
/// `RUSTFLAGS=-D warnings`.
#[cfg(debug_assertions)]
async fn start_dev_auth_server(app_handle: tauri::AppHandle) {
    let listener = match tokio::net::TcpListener::bind("127.0.0.1:0").await {
        Ok(l) => l,
        Err(e) => {
            log::error!("Failed to start dev auth server: {}", e);
            return;
        }
    };

    let port = match listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(e) => {
            log::error!("Failed to get dev auth server address: {}", e);
            return;
        }
    };
    DEV_AUTH_PORT.store(port, Ordering::Relaxed);
    log::info!(
        "Dev auth callback server listening on http://localhost:{}",
        port
    );

    loop {
        let (mut stream, _) = match listener.accept().await {
            Ok(conn) => conn,
            Err(e) => {
                log::warn!("Dev auth server accept error: {}", e);
                continue;
            }
        };

        let handle = app_handle.clone();
        tokio::spawn(async move {
            let mut buf = vec![0u8; 4096];
            let n = match stream.read(&mut buf).await {
                Ok(n) => n,
                Err(_) => return,
            };

            let request = String::from_utf8_lossy(&buf[..n]);

            // Parse the request line: GET /auth-callback?token=...&origin=... HTTP/1.1
            let path = match request.lines().next() {
                Some(line) => {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 && parts[0] == "GET" {
                        parts[1].to_string()
                    } else {
                        String::new()
                    }
                }
                None => String::new(),
            };

            if !path.starts_with("/auth-callback") {
                let response = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n";
                let _ = stream.write_all(response.as_bytes()).await;
                return;
            }

            // Parse query params from the path
            let fake_url = format!("http://localhost{}", path);
            let parsed = match url::Url::parse(&fake_url) {
                Ok(u) => u,
                Err(_) => {
                    let response = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n";
                    let _ = stream.write_all(response.as_bytes()).await;
                    return;
                }
            };

            let token = parsed
                .query_pairs()
                .find(|(k, _)| k == "token")
                .map(|(_, v)| v.to_string());
            let origin = parsed
                .query_pairs()
                .find(|(k, _)| k == "origin")
                .map(|(_, v)| v.to_string());
            let desktop_state = parsed
                .query_pairs()
                .find(|(k, _)| k == "desktop_state")
                .map(|(_, v)| v.to_string());

            match (token, desktop_state) {
                (Some(ref t), Some(ref state))
                    if is_valid_token_format(t)
                        && consume_pending_desktop_auth_state(&handle, state) =>
                {
                    let origin = origin
                        .filter(|o| validate_origin(o))
                        .unwrap_or_else(|| "http://localhost:3000".to_string());

                    let encoded_token: String =
                        url::form_urlencoded::byte_serialize(t.as_bytes()).collect();
                    let encoded_state: String =
                        url::form_urlencoded::byte_serialize(state.as_bytes()).collect();
                    let callback_url = format!(
                        "{}/desktop-callback?token={}&desktop_state={}",
                        origin, encoded_token, encoded_state
                    );

                    log::info!("Dev auth: navigating to the state-bound callback");

                    if let Some(window) = handle.get_webview("main") {
                        let _ = window.window().set_focus();
                        if let Ok(parsed_url) = callback_url.parse() {
                            let _ = window.navigate(parsed_url);
                        }
                    }

                    // Return a page that tells the user to close the tab
                    let body = r#"<!DOCTYPE html><html><head><meta charset="utf-8"><title>Auth Complete</title><style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fff}h1{font-size:1.5rem}</style></head><body><h1>Authentication complete. You can close this tab.</h1><script>window.close()</script></body></html>"#;
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nCache-Control: no-store\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(response.as_bytes()).await;
                }
                _ => {
                    log::warn!("Dev auth: invalid or missing token/auth state");
                    let response = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n";
                    let _ = stream.write_all(response.as_bytes()).await;
                }
            }
        });
    }
}

fn is_valid_token_format(token: &str) -> bool {
    token.len() == 64 && token.chars().all(|c| c.is_ascii_hexdigit())
}

fn validate_origin_for_mode(origin: &str, allow_loopback: bool) -> bool {
    let Ok(parsed) = url::Url::parse(origin) else {
        return false;
    };
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return false;
    }

    if parsed.origin().ascii_serialization() == "https://riftsys.app" {
        return true;
    }
    if !allow_loopback || (parsed.scheme() != "http" && parsed.scheme() != "https") {
        return false;
    }
    match parsed.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    }
}

fn validate_origin(origin: &str) -> bool {
    validate_origin_for_mode(origin, cfg!(debug_assertions))
}

fn consume_pending_desktop_auth_state(app: &tauri::AppHandle, desktop_state: &str) -> bool {
    if !is_valid_token_format(desktop_state) {
        return false;
    }

    let Some(pending_states) = app.try_state::<PendingDesktopAuthStates>() else {
        log::error!("Desktop auth state store is unavailable");
        return false;
    };

    let now = SystemTime::now();
    let mut states = match pending_states.0.lock() {
        Ok(states) => states,
        Err(_) => {
            log::error!("Desktop auth state lock poisoned");
            return false;
        }
    };

    prune_expired_auth_states(&mut states, now);
    states
        .remove(desktop_state)
        .map(|expires_at| expires_at > now)
        .unwrap_or(false)
}

#[tauri::command]
fn github_desktop_callback_scheme(app: tauri::AppHandle) -> String {
    if app.config().identifier == "app.riftsys.ui-preview" { "rift-preview".into() } else { "rift".into() }
}

fn handle_auth_deep_link(app: &tauri::AppHandle, url: &url::Url) {
    if url.scheme() != github_desktop_callback_scheme(app.clone()) {
        return;
    }

    // GitHub authorization occurs in the system browser. Only a pending,
    // one-use native nonce can return it to this window; no access token crosses.
    if url.host_str() == Some("github") {
        let state = url.query_pairs().find(|(k, _)| k == "desktop_state").map(|(_, v)| v.to_string());
        if !state.as_deref().map(|s| consume_pending_desktop_auth_state(app, s)).unwrap_or(false) {
            return;
        }
        if let Some(window) = app.get_webview_window("main") {
            if let Ok(current) = window.url() {
                let path = url.query_pairs().find(|(k, _)| k == "return_to").map(|(_, v)| v.to_string()).unwrap_or_else(|| "/".into());
                if let Ok(mut target) = current.join(&path) {
                    if path.starts_with('/') && !path.starts_with("//") && !path.contains('\\') && target.origin() == current.origin() {
                        let status = if url.query_pairs().any(|(k, v)| k == "github" && v == "connected") { "connected" } else { "error" };
                        target.query_pairs_mut().append_pair("github", status);
                        let _ = window.navigate(target);
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
            }
        }
        return;
    }

    if url.host_str() == Some("auth") || url.path() == "/auth" || url.path() == "auth" {
        match url
            .query_pairs()
            .find(|(k, _)| k == "token")
            .map(|(_, v)| v)
        {
            Some(token) => {
                if !is_valid_token_format(&token) {
                    log::error!("Invalid token format in deep link");
                    return;
                }

                let desktop_state = match url
                    .query_pairs()
                    .find(|(k, _)| k == "desktop_state")
                    .map(|(_, v)| v.to_string())
                {
                    Some(state) if consume_pending_desktop_auth_state(app, &state) => state,
                    _ => {
                        log::error!("Auth deep link missing valid desktop auth state");
                        return;
                    }
                };

                if let Some(window) = app.get_webview("main") {
                    // Get and validate origin from deep link query params
                    let origin = url
                        .query_pairs()
                        .find(|(k, _)| k == "origin")
                        .map(|(_, v)| v.to_string())
                        .filter(|o| validate_origin(o))
                        .unwrap_or_else(|| {
                            log::warn!("Deep link has missing or invalid origin, using production");
                            "https://riftsys.app".to_string()
                        });

                    let encoded_token: String =
                        url::form_urlencoded::byte_serialize(token.as_bytes()).collect();
                    let encoded_state: String =
                        url::form_urlencoded::byte_serialize(desktop_state.as_bytes()).collect();
                    let callback_url = format!(
                        "{}/desktop-callback?token={}&desktop_state={}",
                        origin, encoded_token, encoded_state
                    );
                    log::info!("Navigating to the state-bound desktop callback");

                    match callback_url.parse() {
                        Ok(parsed_url) => {
                            if let Err(e) = window.navigate(parsed_url) {
                                log::error!("Failed to navigate to callback URL: {}", e);
                                // Try to navigate to error page
                                let error_url = format!("{}/login?error=navigation_failed", origin);
                                if let Ok(error_parsed) = error_url.parse() {
                                    let _ = window.navigate(error_parsed);
                                }
                            }
                        }
                        Err(e) => {
                            log::error!("Invalid callback URL format: {}", e);
                        }
                    }
                }
            }
            None => {
                if let Some((_, error)) = url.query_pairs().find(|(k, _)| k == "error") {
                    let _ = error;
                    log::error!("Desktop authentication returned an error");
                } else {
                    log::warn!("Auth deep link received without a token");
                }
            }
        }
    }
}

// ── PTY Commands ─────────────────────────────────────────────────────

type PtyState = std::sync::Arc<std::sync::Mutex<pty::PtyManager>>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopTerminalProfileCapabilities {
    backend: &'static str,
    profiles: Vec<pty::DesktopTerminalProfileCapability>,
}

#[tauri::command]
fn list_desktop_terminal_profiles() -> DesktopTerminalProfileCapabilities {
    DesktopTerminalProfileCapabilities {
        backend: "local",
        profiles: pty::desktop_terminal_profile_capabilities(),
    }
}

#[tauri::command]
fn synchronize_desktop_terminal_owner(
    native_state: tauri::State<'_, native_codex::NativeCodexState>,
    terminal_state: tauri::State<'_, pty::DesktopProfilePtyState>,
    access_state: tauri::State<'_, local_access::LocalAccessState>,
    computer_state: tauri::State<'_, computer_access::ComputerAccessState>,
    owner_id: String,
) -> Result<u64, String> {
    if owner_id.is_empty() || owner_id.len() > 256 {
        return Err("Invalid terminal owner.".into());
    }
    let mut manager = terminal_state
        .lock()
        .map_err(|_| "Terminal state unavailable.")?;
    if manager.owner_changes(&owner_id) {
        native_codex::revoke_all(&native_state);
        local_access::revoke_all_grants(&access_state)?;
        computer_access::revoke_permissions(&computer_state);
    }
    let generation = manager.synchronize_owner(owner_id);
    computer_state.enable_for_signed_in_owner();
    Ok(generation)
}

#[tauri::command]
fn create_desktop_profile_pty(
) -> Result<(), String> {
    Err("Reload RIFT to update the desktop terminal interface.".into())
}

#[tauri::command]
fn create_desktop_profile_pty_v2(
    app: tauri::AppHandle,
    terminal_state: tauri::State<'_, pty::DesktopProfilePtyState>,
    access_state: tauri::State<'_, local_access::LocalAccessState>,
    owner_id: Option<String>,
    owner_generation: Option<u64>,
    client_terminal_id: Option<String>,
    session_id: String,
    attachment_id: Option<String>,
    restart: Option<bool>,
    profile: String,
    grant_id: Option<String>,
    relative_cwd: String,
    cols: u16,
    rows: u16,
    on_data: tauri::ipc::Channel<pty::DesktopTerminalEvent>,
) -> Result<pty::DesktopProfilePtyCreateResult, String> {
    let (owner_id, owner_generation, client_terminal_id, attachment_id) = match (
        owner_id,
        owner_generation,
        client_terminal_id,
        attachment_id,
    ) {
        (Some(owner), Some(generation), Some(client), Some(attachment)) => {
            (owner, generation, client, attachment)
        }
        _ => return Err("Reload RIFT to update the desktop terminal interface.".into()),
    };
    let restart = restart.unwrap_or(false);
    if !pty::valid_profile_session_id(&session_id)
        || !pty::valid_profile_session_id(&client_terminal_id)
        || !pty::valid_profile_session_id(&attachment_id)
    {
        return Err("Desktop terminal identity is invalid.".into());
    }
    if !pty::valid_pty_geometry(cols, rows) {
        return Err("Desktop terminal size is outside the supported range.".into());
    }
    // The terminal lock covers authorization, grant validation and spawn. A
    // concurrent revoke either wins first or kills the completed spawn afterward.
    let mut manager = terminal_state
        .lock()
        .map_err(|_| "Desktop terminal state is unavailable.")?;
    manager.authorize(&owner_id, owner_generation)?;
    let original_grant = if restart {
        manager.grant_for_client(&client_terminal_id)
    } else {
        None
    };
    if let Some(existing) = manager.existing(
        &client_terminal_id,
        &profile,
        restart,
        attachment_id.clone(),
        on_data.clone(),
    )? {
        return Ok(existing);
    }
    let launch = pty::resolve_desktop_terminal_profile(&profile)
        .ok_or("The requested desktop terminal profile is unavailable or not allowed.")?;
    let grant_id = match original_grant {
        Some(id) if id == "standalone-shell" => None,
        Some(id) => Some(id),
        None => grant_id,
    };
    let (cwd, grant_id) = match grant_id {
        Some(id) => (
            local_access::resolve_terminal_workspace_cwd(&access_state, &id, &relative_cwd)?,
            id,
        ),
        None if profile == "shell" && relative_cwd.is_empty() => (
            app.path()
                .home_dir()
                .map_err(|_| "The user home directory is unavailable.")?,
            "standalone-shell".into(),
        ),
        None => return Err("Choose a writable folder for this CLI profile.".into()),
    };
    manager.create(
        // The native process issues the incarnation. A caller reusing an old
        // proposed ID cannot make stale reads/ACKs refer to a replacement PTY.
        format!("native_{}", uuid::Uuid::new_v4().simple()),
        client_terminal_id,
        grant_id,
        launch,
        cols,
        rows,
        &cwd,
        attachment_id,
        on_data,
    )
}

#[tauri::command]
fn read_desktop_profile_pty_output(
    terminal_state: tauri::State<'_, pty::DesktopProfilePtyState>,
    owner_id: String,
    owner_generation: u64,
    session_id: String,
    attachment_id: String,
    cursor: u64,
) -> Result<pty::DesktopTerminalRead, String> {
    let mut manager = terminal_state.lock().map_err(|_| "Desktop terminal state is unavailable.")?;
    manager.authorize(&owner_id, owner_generation)?;
    manager.read_output(&session_id, &attachment_id, cursor)
}

#[tauri::command]
fn acknowledge_desktop_profile_pty_output(
    terminal_state: tauri::State<'_, pty::DesktopProfilePtyState>,
    owner_id: String,
    owner_generation: u64,
    session_id: String,
    attachment_id: String,
    cursor: u64,
) -> Result<(), String> {
    let mut manager = terminal_state.lock().map_err(|_| "Desktop terminal state is unavailable.")?;
    manager.authorize(&owner_id, owner_generation)?;
    manager.acknowledge(&session_id, &attachment_id, cursor)
}

#[tauri::command]
fn detach_desktop_profile_pty(
    terminal_state: tauri::State<'_, pty::DesktopProfilePtyState>,
    owner_id: String,
    owner_generation: u64,
    session_id: String,
    attachment_id: String,
) -> Result<(), String> {
    let mut manager = terminal_state
        .lock()
        .map_err(|_| "Desktop terminal state is unavailable.")?;
    manager.authorize(&owner_id, owner_generation)?;
    manager.detach(&session_id, &attachment_id)
}

#[tauri::command]
fn close_desktop_profile_terminal(
    terminal_state: tauri::State<'_, pty::DesktopProfilePtyState>,
    owner_id: String,
    owner_generation: u64,
    client_terminal_id: String,
) -> Result<(), String> {
    if !pty::valid_profile_session_id(&client_terminal_id) {
        return Err("Invalid terminal tab.".into());
    }
    let mut manager = terminal_state
        .lock()
        .map_err(|_| "Desktop terminal state is unavailable.")?;
    manager.authorize(&owner_id, owner_generation)?;
    manager.close_client(client_terminal_id)
}

#[tauri::command]
async fn send_desktop_profile_pty_input(
    terminal_state: tauri::State<'_, pty::DesktopProfilePtyState>,
    owner_id: String,
    owner_generation: u64,
    session_id: String,
    data: String,
) -> Result<(), String> {
    if !pty::valid_profile_session_id(&session_id)
        || data.len() > pty::MAX_DESKTOP_PROFILE_PTY_INPUT_BYTES
    {
        return Err("Desktop terminal input is invalid or too large.".into());
    }
    let completion = {
        let manager = terminal_state.lock().map_err(|_| "Desktop terminal state is unavailable.")?;
        manager.authorize(&owner_id, owner_generation)?;
        manager.queue_input(&session_id, &data)?
    };
    tauri::async_runtime::spawn_blocking(move || {
        completion.recv().unwrap_or_else(|_| Err("Desktop terminal input closed.".into()))
    }).await.map_err(|_| "Desktop terminal input task failed.".to_string())?
}

#[tauri::command]
fn resize_desktop_profile_pty(
    terminal_state: tauri::State<'_, pty::DesktopProfilePtyState>,
    owner_id: String,
    owner_generation: u64,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    if !pty::valid_profile_session_id(&session_id) || !pty::valid_pty_geometry(cols, rows) {
        return Err("Desktop terminal session or size is invalid.".into());
    }
    let mut manager = terminal_state
        .lock()
        .map_err(|_| "Desktop terminal state is unavailable.")?;
    manager.authorize(&owner_id, owner_generation)?;
    manager.resize(&session_id, cols, rows)
}

#[tauri::command]
fn kill_desktop_profile_pty(
    terminal_state: tauri::State<'_, pty::DesktopProfilePtyState>,
    owner_id: String,
    owner_generation: u64,
    session_id: String,
) -> Result<(), String> {
    let mut manager = terminal_state
        .lock()
        .map_err(|_| "Desktop terminal state is unavailable.")?;
    manager.authorize(&owner_id, owner_generation)?;
    manager.kill(&session_id)
}

#[tauri::command]
async fn execute_pty_create(
    state: tauri::State<'_, PtyState>,
    session_id: String,
    command: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    on_data: tauri::ipc::Channel<String>,
) -> Result<pty::PtyCreateResult, String> {
    let mut manager = state.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
    manager.create(session_id, command, cols, rows, cwd, env, on_data)
}

#[tauri::command]
async fn execute_pty_input(
    state: tauri::State<'_, PtyState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut manager = state.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
    manager.send_input(&session_id, &data)
}

#[tauri::command]
async fn execute_pty_resize(
    state: tauri::State<'_, PtyState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut manager = state.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
    manager.resize(&session_id, cols, rows)
}

#[tauri::command]
async fn execute_pty_kill(
    state: tauri::State<'_, PtyState>,
    session_id: String,
) -> Result<(), String> {
    let mut manager = state.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
    manager.kill(&session_id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .on_window_event(|window, event| {
            // Closing the workspace on macOS hides the window. Its grants,
            // browser views, and local terminals remain alive until explicit
            // Quit; closing the last window is not a request to stop work.
            #[cfg(target_os = "macos")]
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
        })
        .on_page_load(browser::on_page_load)
        .invoke_handler(tauri::generate_handler![
            browser::browser_tab_create,
            browser::browser_tab_navigate,
            browser::browser_tab_action,
            browser::browser_tab_layout,
            browser::browser_tab_snapshot,
            browser::browser_tab_close,
            browser::browser_tabs_hide_all,
            set_desktop_theme,
            get_dev_auth_port,
            prepare_desktop_auth_state,
            github_desktop_callback_scheme,
            get_cmd_server_info,
            get_local_file_metadata,
            read_local_file,
            local_access::get_desktop_platform_info,
            local_access::save_file_to_downloads,
            local_access::request_workspace_access,
            local_access::request_file_access,
            local_access::list_workspace_grants,
            local_access::revoke_workspace_access,
            local_access::list_workspace_entries,
            local_access::read_workspace_file,
            local_access::write_workspace_file,
            computer_access::desktop_access_status,
            computer_access::open_desktop_permission_settings,
            computer_access::set_desktop_access,
            computer_access::revoke_all_desktop_access,
            computer_access::desktop_computer_action,
            local_access::fetch_loopback_url,
            local_access::open_visible_url_with_consent,
            list_desktop_terminal_profiles,
            synchronize_desktop_terminal_owner,
            native_codex::native_codex_open,
            native_codex::native_codex_send,
            native_codex::native_codex_poll,
            native_codex::native_codex_close,
            create_desktop_profile_pty,
            create_desktop_profile_pty_v2,
            read_desktop_profile_pty_output,
            acknowledge_desktop_profile_pty_output,
            detach_desktop_profile_pty,
            close_desktop_profile_terminal,
            send_desktop_profile_pty_input,
            resize_desktop_profile_pty,
            kill_desktop_profile_pty,
            execute_command,
            execute_stream_command,
            cancel_stream_command,
            execute_pty_create,
            execute_pty_input,
            execute_pty_resize,
            execute_pty_kill
        ])
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Handle deep links passed as CLI args (Linux/Windows)
            log::info!("Single instance callback received");
            for arg in args.iter().skip(1) {
                if let Ok(url) = url::Url::parse(arg) {
                    if url.scheme() == github_desktop_callback_scheme(app.clone()) {
                        log::info!("Processing a desktop deep link");
                        handle_auth_deep_link(app, &url);
                    }
                }
            }
            // Focus the main window
            if let Some(window) = app.get_window("main") {
                let _ = window.set_focus();
            }
        }))
        .manage(std::sync::Arc::new(std::sync::Mutex::new(pty::PtyManager::new())) as PtyState)
        .manage(
            std::sync::Arc::new(std::sync::Mutex::new(HashMap::<String, u32>::new()))
                as StreamCommandState,
        )
        .manage(PendingDesktopAuthStates(std::sync::Mutex::new(
            HashMap::new(),
        )))
        .manage(local_access::new_local_access_state())
        .manage(computer_access::ComputerAccessState::default())
        .manage(browser::BrowserState::default())
        .manage(pty::new_desktop_profile_pty_state())
        .manage(native_codex::NativeCodexState::default())
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;

                // Register deep links at runtime for Linux/Windows
                // This is required for AppImage and non-installed Windows builds
                #[cfg(any(target_os = "linux", target_os = "windows"))]
                {
                    if let Err(e) = app.deep_link().register_all() {
                        log::warn!("Failed to register deep links: {}", e);
                    } else {
                        log::info!("Deep links registered successfully");
                    }
                }

                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let urls = event.urls();
                    log::info!("Desktop deep link event received");

                    for url in urls {
                        handle_auth_deep_link(&handle, &url);
                    }
                });
            }

            // A window that loads a remote app needs a way to fetch it again.
            // Tauri's default macOS menu has no Reload, so the webview kept
            // whatever it loaded at launch: a deploy could not reach the user
            // without quitting the app, and quitting is what drops the session.
            #[cfg(desktop)]
            {
                use tauri::menu::{
                    AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu,
                };

                let handle = app.handle();
                let reload =
                    MenuItem::with_id(handle, "reload", "Reload", true, Some("CmdOrCtrl+R"))?;
                let reload_rift =
                    MenuItem::with_id(handle, "reload-rift", "Reload RIFT", true, None::<&str>)?;
                let new_chat = MenuItem::with_id(
                    handle,
                    "new-chat",
                    "New Chat",
                    true,
                    Some("CmdOrCtrl+N"),
                )?;
                let search = MenuItem::with_id(handle, "search", "Search", true, Some("CmdOrCtrl+K"))?;
                let settings = MenuItem::with_id(handle, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?;

                let app_menu = Submenu::with_items(
                    handle,
                    "RIFT",
                    true,
                    &[
                        &PredefinedMenuItem::about(handle, None, Some(AboutMetadata::default()))?,
                        &PredefinedMenuItem::separator(handle)?,
                        &settings,
                        &PredefinedMenuItem::separator(handle)?,
                        &PredefinedMenuItem::hide(handle, None)?,
                        &PredefinedMenuItem::hide_others(handle, None)?,
                        &PredefinedMenuItem::show_all(handle, None)?,
                        &PredefinedMenuItem::separator(handle)?,
                        &PredefinedMenuItem::quit(handle, None)?,
                    ],
                )?;

                let file_menu = Submenu::with_items(handle, "File", true, &[&new_chat])?;

                // The webview owns a text field on every screen, so the edit
                // menu carries the system shortcuts the field expects.
                let edit_menu = Submenu::with_items(
                    handle,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(handle, None)?,
                        &PredefinedMenuItem::redo(handle, None)?,
                        &PredefinedMenuItem::separator(handle)?,
                        &PredefinedMenuItem::cut(handle, None)?,
                        &PredefinedMenuItem::copy(handle, None)?,
                        &PredefinedMenuItem::paste(handle, None)?,
                        &PredefinedMenuItem::select_all(handle, None)?,
                        &PredefinedMenuItem::separator(handle)?,
                        &search,
                    ],
                )?;

                let view_menu =
                    Submenu::with_items(handle, "View", true, &[&reload, &reload_rift])?;

                let window_menu = Submenu::with_items(
                    handle,
                    "Window",
                    true,
                    &[
                        &PredefinedMenuItem::minimize(handle, None)?,
                        &PredefinedMenuItem::maximize(handle, None)?,
                        &PredefinedMenuItem::separator(handle)?,
                        &PredefinedMenuItem::close_window(handle, None)?,
                    ],
                )?;

                let menu = Menu::with_items(
                    handle,
                    &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu],
                )?;
                app.set_menu(menu)?;

                app.on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "reload" => {
                            let handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = browser::reload_from_menu(handle).await;
                            });
                        }
                        "reload-rift" => {
                            if let Some(main) = app.get_webview("main") {
                                let _ = main.reload();
                            }
                        }
                        "new-chat" | "search" | "settings" => {
                            let action = match event.id().as_ref() {
                                "new-chat" => "new-chat",
                                "search" => "search",
                                _ => "settings",
                            };
                            if let Some(main) = app.get_webview("main") {
                                let _ = main.set_focus();
                            }
                            let _ = app.emit_to(
                                tauri::EventTarget::webview("main"),
                                "rift:desktop-menu-action",
                                DesktopMenuAction { action },
                            );
                        }
                        _ => {}
                    }
                });
            }

            // The main window is created from tauri.conf.json before setup.
            // Keep it transparent and apply native macOS sidebar vibrancy so
            // the web app's translucent shell reveals real desktop material.
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{
                    apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
                };

                if let Some(window) = app.get_webview_window("main") {
                    window_chrome::configure(&window)?;
                    if let Err(error) = apply_vibrancy(
                        &window,
                        NSVisualEffectMaterial::Sidebar,
                        // Keep the material stable when focus moves to another app.
                        // Cursor Agents also uses an always-active sidebar material.
                        Some(NSVisualEffectState::Active),
                        None,
                    ) {
                        log::warn!("Failed to apply macOS window vibrancy: {}", error);
                    }
                } else {
                    log::warn!("Main window unavailable for macOS vibrancy");
                }
            }

            // Start dev auth callback server when running in debug mode
            // (deep links don't work with `tauri dev` on macOS)
            #[cfg(debug_assertions)]
            {
                let dev_handle = app.handle().clone();
                tauri::async_runtime::spawn(start_dev_auth_server(dev_handle));
            }

            // The legacy arbitrary command server is a development aid only.
            // Production uses consented, operation-specific IPC from
            // `local_access`; it never exposes a bearer token for a host shell.
            #[cfg(debug_assertions)]
            tauri::async_runtime::spawn(start_cmd_server());

            log::info!("RIFT Desktop initialized");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            if let tauri::RunEvent::Exit = event {
                if let Some(native_state) = app.try_state::<native_codex::NativeCodexState>() {
                    native_codex::revoke_all(&native_state);
                }
                if let Some(pty_state) = app.try_state::<PtyState>() {
                    if let Ok(mut manager) = pty_state.lock() {
                        manager.stop_all();
                    }
                }
                if let Some(terminal_state) = app.try_state::<pty::DesktopProfilePtyState>() {
                    if let Ok(mut manager) = terminal_state.lock() {
                        manager.stop_all();
                    }
                }
            }
        });
}

#[cfg(test)]
mod desktop_auth_tests {
    use super::*;

    #[test]
    fn native_appearance_is_main_only_and_supports_system_following() {
        for label in ["browser-test", "", "Main", "main-child"] {
            assert!(desktop_theme_for_caller(label, DesktopTheme::Dark).is_err());
        }
        assert_eq!(desktop_theme_for_caller("main", DesktopTheme::Light).unwrap(), Some(tauri::Theme::Light));
        assert_eq!(desktop_theme_for_caller("main", DesktopTheme::Dark).unwrap(), Some(tauri::Theme::Dark));
        assert_eq!(desktop_theme_for_caller("main", DesktopTheme::System).unwrap(), None);
        assert!(serde_json::from_str::<DesktopTheme>("\"arbitrary\"").is_err());
    }

    #[test]
    fn production_origin_policy_is_exact() {
        assert!(validate_origin_for_mode("https://riftsys.app", false));
        assert!(!validate_origin_for_mode("https://riftsys.app:8443", false));
        assert!(!validate_origin_for_mode("https://riftsys.app/path", false));
        assert!(!validate_origin_for_mode(
            "https://user:riftsys.app@attacker.test",
            false
        ));
        assert!(!validate_origin_for_mode("http://localhost:3010", false));
    }

    #[test]
    fn development_origin_policy_accepts_only_loopback_exceptions() {
        assert!(validate_origin_for_mode("http://localhost:3010", true));
        assert!(validate_origin_for_mode("http://127.0.0.1:3010", true));
        assert!(validate_origin_for_mode("http://[::1]:3010", true));
        assert!(!validate_origin_for_mode(
            "http://localhost.attacker.test",
            true
        ));
    }

    #[test]
    fn old_terminal_web_contract_requires_reload_without_spawning() {
        assert!(super::create_desktop_profile_pty().unwrap_err().contains("Reload RIFT"));
    }
}
