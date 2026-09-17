use super::parse_headers;
#[test]
fn relay_rejects_unscoped_requests_and_ambiguous_framing() {
    let valid =
        "POST /responses HTTP/1.1\r\nAuthorization: Bearer test\r\nContent-Length: 7\r\n\r\n";
    assert_eq!(parse_headers(valid, "test"), Ok(7));
    for invalid in [
        valid.replace("Bearer test", "Bearer stolen"),
        valid.replace("/responses", "/api/keys"),
        valid.replace(
            "Content-Length: 7",
            "Content-Length: 7\r\nContent-Length: 8",
        ),
        valid.replace("Content-Length: 7", "Transfer-Encoding: chunked"),
        valid.replace(
            "Content-Length: 7",
            "Content-Length: 7\r\nOrigin: http://localhost",
        ),
    ] {
        assert!(parse_headers(&invalid, "test").is_err());
    }
}

#[tokio::test]
async fn relay_forwards_fragmented_body_and_streams_without_exposing_account_key() {
    use super::*;
    let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/model", upstream.local_addr().unwrap());
    let source = tokio::spawn(async move {
        let (mut socket, _) = upstream.accept().await.unwrap();
        let mut input = vec![0; 4096];
        let n = socket.read(&mut input).await.unwrap();
        let request = String::from_utf8_lossy(&input[..n]);
        assert!(request
            .to_lowercase()
            .contains("authorization: bearer account-key"));
        assert!(!request.contains("scoped-token"));
        assert!(request.ends_with("{\"x\":1}"));
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 12\r\n\r\ndata: first\n").await.unwrap();
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut child = TcpStream::connect(listener.local_addr().unwrap())
        .await
        .unwrap();
    let (socket, _) = listener.accept().await.unwrap();
    let task = tokio::spawn(async move {
        forward(
            socket,
            reqwest::Client::new(),
            "account-key",
            "scoped-token",
            &endpoint,
        )
        .await
    });
    child.write_all(b"POST /responses HTTP/1.1\r\nAuthorization: Bearer scoped-token\r\nContent-Length: 7\r\n\r\n{\"x").await.unwrap();
    tokio::task::yield_now().await;
    child.write_all(b"\":1}").await.unwrap();
    let mut output = String::new();
    tokio::time::timeout(Duration::from_secs(5), child.read_to_string(&mut output))
        .await
        .unwrap()
        .unwrap();
    assert!(output.contains("data: first"));
    assert!(!output.contains("account-key"));
    task.await.unwrap().unwrap();
    source.await.unwrap();
}

#[tokio::test]
async fn existing_rift_key_cannot_start_a_relay_for_a_different_owner() {
    use super::*;
    let home = std::env::temp_dir().join(format!("rift-relay-owner-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(home.join(".config/rift")).unwrap();
    let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", upstream.local_addr().unwrap());
    std::fs::write(
        home.join(".config/rift/console.json"),
        serde_json::to_vec(&serde_json::json!({"app":origin,"apiKey":"rift_live_fixture"}))
            .unwrap(),
    )
    .unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = upstream.accept().await.unwrap();
        let mut request = [0; 4096];
        let n = socket.read(&mut request).await.unwrap();
        assert!(
            String::from_utf8_lossy(&request[..n]).starts_with("GET /api/console/native/config ")
        );
        let body = r#"{"ownerId":"account-a","models":[],"defaultModel":"build-codex"}"#;
        socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
    });
    let result = start(&home, &origin, "account-b").await;
    assert!(result.err().unwrap().contains("another RIFT account"));
    server.await.unwrap();
    std::fs::remove_dir_all(home).unwrap();
}
