use mino_core::{resolve_default_data_dir, Error, Result};
use mino_mcp::{parse_error, start_http_server_with_remote, McpHandler, SERVER_NAME};
use std::{
    io::{self, BufRead, Write},
    net::SocketAddr,
    path::PathBuf,
};

const HELP:&str="GameWorkSpace MCP server
Usage: gameworkspace-mcp [--data-dir PATH] [--stdio | --http 127.0.0.1:PORT [--token TOKEN] [--allow-remote]]
Default transport: newline-delimited JSON-RPC over stdio.
--help     Show this help
--version  Show server version";

fn stdio(handler: McpHandler) -> Result<()> {
    let mut out = io::stdout().lock();
    for line in io::stdin().lock().lines() {
        let line = line?;
        let reply = match serde_json::from_str(&line) {
            Ok(r) => handler.handle_request(&r),
            Err(_) => Some(parse_error()),
        };
        if let Some(value) = reply {
            serde_json::to_writer(&mut out, &value)?;
            writeln!(out)?;
            out.flush()?;
        }
    }
    Ok(())
}
async fn run() -> Result<()> {
    let mut args = std::env::args_os().skip(1);
    let mut data = None;
    let mut http = None;
    let mut token = None;
    let mut remote = false;
    let mut use_stdio = false;
    while let Some(arg) = args.next() {
        let flag = arg.to_str().unwrap_or("");
        let mut next = || {
            args.next()
                .ok_or_else(|| Error::Invalid(format!("Missing value for {flag}")))
        };
        match flag {
            "--help" | "-h" => {
                println!("{HELP}");
                return Ok(());
            }
            "--version" | "-V" => {
                println!("{SERVER_NAME} {}", env!("CARGO_PKG_VERSION"));
                return Ok(());
            }
            "--stdio" => use_stdio = true,
            "--allow-remote" => remote = true,
            "--data-dir" => data = Some(PathBuf::from(next()?)),
            "--http" => {
                let address = next()?
                    .into_string()
                    .map_err(|_| Error::Invalid("Expected HOST:PORT".into()))?;
                let mut resolved = tokio::net::lookup_host(address)
                    .await?
                    .collect::<Vec<SocketAddr>>();
                resolved.sort_by_key(|a| !a.is_ipv4());
                http = Some(
                    resolved
                        .into_iter()
                        .next()
                        .ok_or_else(|| Error::Invalid("Host has no address".into()))?,
                );
            }
            "--token" => {
                token = Some(
                    next()?
                        .into_string()
                        .map_err(|_| Error::Invalid("Invalid token encoding".into()))?,
                )
            }
            _ => return Err(Error::Invalid("Unknown option, see --help".into())),
        }
    }
    if (use_stdio && http.is_some()) || (http.is_none() && (remote || token.is_some())) {
        return Err(Error::Invalid(
            "Conflicting transport options, see --help".into(),
        ));
    }
    let path = match data {
        Some(p) => p,
        None => resolve_default_data_dir()?,
    };
    let handler = McpHandler::open(&path)?;
    match http {
        None => stdio(handler),
        Some(addr) => {
            let mut server = start_http_server_with_remote(handler, addr, token, remote).await?;
            eprintln!("Listening on http://{}/mcp", server.addr);
            tokio::select! {
                result=&mut server.handle=>{result.map_err(|e|Error::Invalid(e.to_string()))??;Ok(())},
                signal=tokio::signal::ctrl_c()=>{signal?;server.stop().await}
            }
        }
    }
}
#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
