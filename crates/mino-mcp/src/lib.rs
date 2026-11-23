mod actions;
mod catalog;
mod graph;
mod http;

use catalog::{validate, ENTITY_FIELDS, TOOLS};
pub use http::{start_http_server, start_http_server_with_remote, HttpServer};
use mino_core::{export, Database, Error, Result};
use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, CONTROLS};
use serde_json::{json, Value};
use std::{path::Path, sync::Arc};

pub const SERVER_NAME: &str = "gameworkspace-mcp";
const VERSION: &str = env!("CARGO_PKG_VERSION");
const PATH_SEGMENT: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'%')
    .add(b'/')
    .add(b'?')
    .add(b'#')
    .add(b'\\')
    .add(b'{')
    .add(b'}');
const RESOURCE_KINDS: [(&str, &str, &str); 3] = [
    (
        "overview",
        "项目概览 / Project overview",
        "application/json",
    ),
    ("schema", "条目字段 / Entity schema", "application/json"),
    (
        "export/markdown",
        "游戏设计文档 / Live GDD",
        "text/markdown",
    ),
];
fn templates() -> Vec<Value> {
    RESOURCE_KINDS.iter().map(|(path,name,mime)| json!({"uriTemplate":format!("gws://project/{{projectId}}/{path}"),"name":name,"mimeType":mime})).collect()
}
fn root_resource() -> Value {
    json!({"uri":"gws://projects","name":"项目列表 / Projects","mimeType":"application/json"})
}
pub fn directory() -> Value {
    let mut resources = vec![root_resource()];
    resources.extend(templates());
    json!({"tools":TOOLS.iter().map(|t| json!({"name":t["name"],"description":t["description"]})).collect::<Vec<_>>(),"resources":resources})
}
fn resources(db: &Database) -> Result<Value> {
    let mut resources = vec![root_resource()];
    for p in db.list_projects()? {
        let id = utf8_percent_encode(&p.id, PATH_SEGMENT);
        for (path, label, mime) in RESOURCE_KINDS {
            resources.push(json!({"uri":format!("gws://project/{id}/{path}"),"name":format!("{} · {label}",p.name),"mimeType":mime}));
        }
    }
    Ok(json!({"resources":resources}))
}
fn read(db: &Database, uri: &str) -> Result<Value> {
    let (mime, text) = if uri == "gws://projects" {
        ("application/json", actions::projects(db)?.to_string())
    } else {
        let (segment, kind) = uri
            .strip_prefix("gws://project/")
            .and_then(|x| x.split_once('/'))
            .ok_or(Error::Missing)?;
        let id = percent_decode_str(segment)
            .decode_utf8()
            .map_err(|_| Error::Missing)?;
        match kind {
            "overview" => ("application/json", actions::overview(db, &id)?.to_string()),
            "schema" => {
                db.get_project(&id)?;
                ("application/json",json!({"entityTypes":*ENTITY_FIELDS,"sharedDataFields":{"graphX":"number","graphY":"number"}}).to_string())
            }
            "export/markdown" => ("text/markdown", export::render_project_markdown(db, &id)?),
            _ => return Err(Error::Missing),
        }
    };
    Ok(json!({"contents":[{"uri":uri,"mimeType":mime,"text":text}]}))
}
fn error(id: &Value, code: i32, message: &str) -> Value {
    json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}})
}
pub fn parse_error() -> Value {
    error(&Value::Null, -32700, "Parse error")
}

#[derive(Clone)]
pub struct McpHandler {
    db: Arc<Database>,
}
impl McpHandler {
    pub fn open(path: &Path) -> Result<Self> {
        Ok(Self {
            db: Arc::new(Database::open_mcp(path)?),
        })
    }
    // Embedded services also need a distinct, source-tagged connection.
    pub fn new(db: &Database) -> Result<Self> {
        Self::open(db.data_dir())
    }

    pub fn handle_request(&self, request: &Value) -> Option<Value> {
        if let Some(batch) = request.as_array() {
            if batch.is_empty() {
                return Some(error(&Value::Null, -32600, "Empty batch"));
            }
            let replies: Vec<_> = batch.iter().filter_map(|r| self.single(r)).collect();
            return (!replies.is_empty()).then_some(Value::Array(replies));
        }
        self.single(request)
    }
    fn single(&self, r: &Value) -> Option<Value> {
        let id = &r["id"];
        if r["jsonrpc"] != "2.0" || !(id.is_null() || id.is_string() || id.is_number()) {
            return Some(error(&Value::Null, -32600, "Invalid Request"));
        }
        let Some(method) = r["method"].as_str() else {
            if r.get("id").is_some() && (r.get("result").is_some() ^ r.get("error").is_some()) {
                return None;
            }
            return Some(error(id, -32600, "Missing method"));
        };
        r.get("id")?;
        let p = &r["params"];
        if !p.is_null() && !p.is_object() {
            return Some(error(id, -32602, "Expected params object"));
        }
        let result = match method {
            "initialize" => {
                let version = match p["protocolVersion"].as_str() {
                    Some("2024-11-05") => "2024-11-05",
                    _ => "2025-03-26",
                };
                Ok(
                    json!({"protocolVersion":version,"serverInfo":{"name":SERVER_NAME,"version":VERSION},"capabilities":{"resources":{"listChanged":false},"tools":{"listChanged":false}}}),
                )
            }
            "ping" => Ok(json!({})),
            "resources/list" => resources(&self.db),
            "resources/templates/list" => Ok(json!({"resourceTemplates":templates()})),
            "resources/read" => match p["uri"].as_str() {
                Some(uri) => read(&self.db, uri),
                None => return Some(error(id, -32602, "Expected resource URI")),
            },
            "tools/list" => Ok(json!({"tools":*TOOLS})),
            "tools/call" => {
                let name = p["name"].as_str().unwrap_or("");
                let Some(tool) = TOOLS.iter().find(|t| t["name"] == name) else {
                    return Some(error(id, -32602, "Unknown tool"));
                };
                let empty = json!({});
                let args = p.get("arguments").unwrap_or(&empty);
                if let Err(msg) = validate(&tool["inputSchema"], args, "arguments") {
                    return Some(error(id, -32602, &msg));
                }
                let (text, is_error) = match actions::call(&self.db, name, args) {
                    Ok(Value::String(text)) => (text, false),
                    Ok(value) => (value.to_string(), false),
                    Err(e) => (e.to_string(), true),
                };
                Ok(json!({"content":[{"type":"text","text":text}],"isError":is_error}))
            }
            _ => return Some(error(id, -32601, "Method not found")),
        };
        Some(match result {
            Ok(value) => json!({"jsonrpc":"2.0","id":id,"result":value}),
            Err(Error::Missing) => error(id, -32002, "Resource not found"),
            Err(e) => error(id, -32603, &e.to_string()),
        })
    }
    pub fn self_check(&self) -> Result<Value> {
        let start = std::time::Instant::now();
        let call = |method, params| {
            let r = self
                .handle_request(&json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}))
                .ok_or(Error::Missing)?;
            if r.get("error").is_some() || r["result"]["isError"] == true {
                return Err(Error::Invalid(format!("MCP self-check failed at {method}")));
            }
            Ok(r["result"].clone())
        };
        call(
            "initialize",
            json!({"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"GameWorkSpace","version":VERSION}}),
        )?;
        let tools = call("tools/list", json!({}))?;
        let resources = call("resources/list", json!({}))?;
        let projects = call("tools/call", json!({"name":"list_projects","arguments":{}}))?;
        let rows: Vec<Value> = serde_json::from_str(
            projects["content"][0]["text"]
                .as_str()
                .ok_or(Error::Missing)?,
        )?;
        Ok(
            json!({"ok":true,"latencyMs":start.elapsed().as_secs_f64()*1000.0,"toolCount":tools["tools"].as_array().ok_or(Error::Missing)?.len(),"resourceCount":resources["resources"].as_array().ok_or(Error::Missing)?.len(),"projectCount":rows.len(),"message":"握手、目录和项目读取成功"}),
        )
    }
}
