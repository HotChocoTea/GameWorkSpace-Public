use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

pub async fn server(body: String, sse: bool) -> (String, tokio::task::JoinHandle<String>) {
    server_with(body, sse, || {}).await
}
pub async fn server_with(
    body: String,
    sse: bool,
    before_response: impl FnOnce() + Send + 'static,
) -> (String, tokio::task::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let handle = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut bytes = Vec::new();
        let mut chunk = [0u8; 2048];
        let end = loop {
            let n = socket.read(&mut chunk).await.unwrap();
            assert!(n > 0);
            bytes.extend_from_slice(&chunk[..n]);
            if let Some(i) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                break i + 4;
            }
        };
        let header = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
        let count = header
            .lines()
            .find_map(|l| l.strip_prefix("content-length: "))
            .and_then(|v| v.parse().ok())
            .unwrap_or(0usize);
        while bytes.len() < end + count {
            let n = socket.read(&mut chunk).await.unwrap();
            assert!(n > 0);
            bytes.extend_from_slice(&chunk[..n]);
        }
        before_response();
        let mime = if sse {
            "text/event-stream"
        } else {
            "application/json"
        };
        socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len()).as_bytes()).await.unwrap();
        for part in body.as_bytes().chunks(13) {
            socket.write_all(part).await.unwrap();
            tokio::task::yield_now().await;
        }
        String::from_utf8(bytes).unwrap()
    });
    (url, handle)
}
