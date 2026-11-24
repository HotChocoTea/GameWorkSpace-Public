use crate::{parse_error, McpHandler, SERVER_NAME};
use http_body_util::{BodyExt, Full, Limited};
use hyper::{
    body::{Bytes, Incoming},
    header,
    server::conn::http1,
    service::service_fn,
    Method, Request, Response, StatusCode, Uri,
};
use hyper_util::rt::{TokioIo, TokioTimer};
use gws_core::{Error, Result};
use serde_json::{json, Value};
use std::{
    convert::Infallible,
    net::{Ipv4Addr, SocketAddr},
    sync::Arc,
    time::Duration,
};
use tokio::{
    net::TcpListener,
    sync::{oneshot, watch},
    task::{JoinHandle, JoinSet},
};

pub struct HttpServer {
    pub addr: SocketAddr,
    pub shutdown: oneshot::Sender<()>,
    pub handle: JoinHandle<std::io::Result<()>>,
}
impl HttpServer {
    pub async fn stop(self) -> Result<()> {
        let _ = self.shutdown.send(());
        self.handle
            .await
            .map_err(|e| Error::Invalid(e.to_string()))??;
        Ok(())
    }
}
pub async fn start_http_server(
    db: &gws_core::Database,
    addr: SocketAddr,
    token: Option<String>,
) -> Result<HttpServer> {
    start_http_server_with_remote(McpHandler::new(db)?, addr, token, false).await
}
pub async fn start_http_server_with_remote(
    handler: McpHandler,
    addr: SocketAddr,
    token: Option<String>,
    allow_remote: bool,
) -> Result<HttpServer> {
    if !allow_remote && addr.ip() != Ipv4Addr::LOCALHOST {
        return Err(Error::Invalid(
            "HTTP 地址须为 127.0.0.1，其他地址需显式 --allow-remote".into(),
        ));
    }
    if token.as_ref().is_some_and(|s| s.trim().is_empty()) {
        return Err(Error::Invalid("Bearer token 不能为空".into()));
    }
    let listener = TcpListener::bind(addr).await?;
    let addr = listener.local_addr()?;
    let token = token.map(Arc::<str>::from);
    let (shutdown, mut stop) = oneshot::channel();
    let handle = tokio::spawn(async move {
        let (closing, signal) = watch::channel(false);
        let mut clients = JoinSet::new();
        loop {
            tokio::select! {
                _=&mut stop=>break,
                Some(_)=clients.join_next()=>(),
                incoming=listener.accept()=>{
                    let (socket,_)=incoming?;
                    let handler=handler.clone();
                    let token=token.clone();
                    let mut signal=signal.clone();
                    clients.spawn(async move{
                        let service=service_fn(move|r|serve(r,handler.clone(),token.clone(),allow_remote));
                        let conn=http1::Builder::new().timer(TokioTimer::new()).header_read_timeout(Duration::from_secs(15)).serve_connection(TokioIo::new(socket),service);
                        tokio::pin!(conn);
                        tokio::select!{
                            _=&mut conn=>(),
                            _=signal.changed()=>{conn.as_mut().graceful_shutdown();let _=conn.await;},
                        }
                    });
                }
            }
        }
        drop(listener);
        let _ = closing.send(true);
        while clients.join_next().await.is_some() {}
        Ok(())
    });
    Ok(HttpServer {
        addr,
        shutdown,
        handle,
    })
}

type Reply = Response<Full<Bytes>>;
fn response(status: StatusCode, body: impl Into<Bytes>) -> Reply {
    let mut r = Response::new(Full::new(body.into()));
    *r.status_mut() = status;
    r.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("application/json"),
    );
    r
}
fn local(host: Option<&str>) -> bool {
    matches!(host, Some("localhost" | "127.0.0.1" | "[::1]"))
}
async fn serve(
    r: Request<Incoming>,
    handler: McpHandler,
    token: Option<Arc<str>>,
    remote: bool,
) -> std::result::Result<Reply, Infallible> {
    let origin = r.headers().get(header::ORIGIN).cloned();
    if let Some(o) = &origin {
        let parsed = o.to_str().ok().and_then(|s| s.parse::<Uri>().ok());
        if !parsed.is_some_and(|u| {
            matches!(u.scheme_str(), Some("http" | "https"))
                && local(u.host())
                && u.authority().is_some_and(|a| !a.as_str().contains('@'))
                && u.path() == "/"
                && u.query().is_none()
        }) {
            return Ok(response(StatusCode::FORBIDDEN, ""));
        }
    }
    if !remote {
        let host = r
            .headers()
            .get(header::HOST)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<hyper::http::uri::Authority>().ok());
        if !host
            .as_ref()
            .is_some_and(|h| !h.as_str().contains('@') && local(Some(h.host())))
        {
            return Ok(response(StatusCode::FORBIDDEN, ""));
        }
    }
    let mut result = route(r, handler, token).await;
    if let Some(origin) = origin {
        result
            .headers_mut()
            .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        result
            .headers_mut()
            .insert(header::VARY, header::HeaderValue::from_static("Origin"));
    }
    Ok(result)
}
async fn route(r: Request<Incoming>, handler: McpHandler, token: Option<Arc<str>>) -> Reply {
    if r.uri().path() == "/health" && r.method() == Method::GET {
        return response(
            StatusCode::OK,
            json!({"ok":true,"server":SERVER_NAME}).to_string(),
        );
    }
    if r.uri().path() != "/mcp" {
        return response(StatusCode::NOT_FOUND, "");
    }
    if r.method() == Method::OPTIONS {
        let mut res = response(StatusCode::NO_CONTENT, "");
        res.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            header::HeaderValue::from_static("POST, OPTIONS"),
        );
        res.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            header::HeaderValue::from_static(
                "Authorization, Content-Type, Accept, MCP-Protocol-Version",
            ),
        );
        return res;
    }
    if let Some(secret) = token {
        if r.headers()
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.strip_prefix("Bearer "))
            != Some(secret.as_ref())
        {
            let mut res = response(StatusCode::UNAUTHORIZED, "");
            res.headers_mut().insert(
                header::WWW_AUTHENTICATE,
                header::HeaderValue::from_static("Bearer"),
            );
            return res;
        }
    }
    if r.method() != Method::POST {
        let mut res = response(StatusCode::METHOD_NOT_ALLOWED, "");
        res.headers_mut().insert(
            header::ALLOW,
            header::HeaderValue::from_static("POST, OPTIONS"),
        );
        return res;
    }
    if !r
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(';')
                .next()
                .is_some_and(|t| t.trim().eq_ignore_ascii_case("application/json"))
        })
    {
        return response(StatusCode::UNSUPPORTED_MEDIA_TYPE, "");
    }
    let body = match tokio::time::timeout(
        Duration::from_secs(15),
        Limited::new(r.into_body(), 8 * 1024 * 1024).collect(),
    )
    .await
    {
        Ok(Ok(b)) => b.to_bytes(),
        Ok(Err(_)) => return response(StatusCode::PAYLOAD_TOO_LARGE, ""),
        Err(_) => return response(StatusCode::REQUEST_TIMEOUT, ""),
    };
    let req: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return response(StatusCode::BAD_REQUEST, parse_error().to_string()),
    };
    match tokio::task::spawn_blocking(move || handler.handle_request(&req)).await {
        Ok(Some(reply)) => response(StatusCode::OK, reply.to_string()),
        Ok(None) => response(StatusCode::ACCEPTED, ""),
        Err(_) => response(StatusCode::INTERNAL_SERVER_ERROR, ""),
    }
}
