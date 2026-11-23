use mino_core::{Database, MapRecord, Project, DATABASE_NAME};
use mino_mcp::{start_http_server, McpHandler};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
use tempfile::tempdir;

const SENTINEL: &str = "synthetic-e2e-provider-secret";
fn rpc(id: u64, method: &str, params: Value) -> Value {
    json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})
}
fn tool(name: &str, args: Value) -> Value {
    rpc(1, "tools/call", json!({"name":name,"arguments":args}))
}
fn initialize(version: &str) -> Value {
    json!({"protocolVersion":version,"capabilities":{},"clientInfo":{"name":"test","version":"1"}})
}
fn content(result: Value) -> Value {
    assert_eq!(result["isError"], false, "{result}");
    let s = result["content"][0]["text"].as_str().unwrap();
    serde_json::from_str(s).unwrap_or_else(|_| json!(s))
}
struct Client {
    child: Child,
    lines: mpsc::Receiver<String>,
    seq: u64,
}
impl Client {
    fn spawn(path: &Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_gameworkspace-mcp"))
            .arg("--stdio")
            .arg("--data-dir")
            .arg(path)
            .env("GAMEWORKSPACE_DATA_DIR", path.join("ignored"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let reader = BufReader::new(child.stdout.take().unwrap());
        let (tx, lines) = mpsc::channel();
        thread::spawn(move || {
            for line in reader.lines() {
                if tx.send(line.unwrap()).is_err() {
                    break;
                }
            }
        });
        Self {
            child,
            lines,
            seq: 0,
        }
    }
    fn send(&mut self, line: &str) {
        writeln!(self.child.stdin.as_mut().unwrap(), "{line}").unwrap();
    }
    fn receive(&self) -> Value {
        let line = self
            .lines
            .recv_timeout(Duration::from_secs(10))
            .expect("MCP reply timeout");
        assert!(!line.contains(SENTINEL));
        serde_json::from_str(&line).expect("non-protocol stdout")
    }
    fn exchange(&mut self, method: &str, params: Value) -> Value {
        self.seq += 1;
        self.send(&rpc(self.seq, method, params).to_string());
        let r = self.receive();
        assert_eq!(r["id"], self.seq);
        assert_eq!(r["jsonrpc"], "2.0");
        r
    }
    fn request(&mut self, method: &str, params: Value) -> Value {
        let r = self.exchange(method, params);
        assert!(r.get("error").is_none(), "{r}");
        r["result"].clone()
    }
    fn call(&mut self, name: &str, args: Value) -> Value {
        content(self.request("tools/call", json!({"name":name,"arguments":args})))
    }
    fn finish(mut self) {
        self.child.stdin.take();
        assert!(self.child.wait().unwrap().success());
        assert!(
            self.lines.iter().next().is_none(),
            "unexpected stdout after last reply"
        );
        let mut err = String::new();
        self.child
            .stderr
            .as_mut()
            .unwrap()
            .read_to_string(&mut err)
            .unwrap();
        assert!(!err.contains(SENTINEL));
    }
}
impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
fn setup(db: &Database) {
    db.save_project(&Project {
        id: "p".into(),
        name: "桌面项目".into(),
        ..Default::default()
    })
    .unwrap();
}
fn assert_no_secret(bytes: &[u8]) {
    assert!(!bytes
        .windows(SENTINEL.len())
        .any(|s| s == SENTINEL.as_bytes()));
}

#[test]
fn stdio_agent_and_desktop_round_trip() {
    let dir = tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    setup(&db);
    #[cfg(windows)]
    db.set_api_key("test-provider", SENTINEL).unwrap();
    db.save_setting("private-test-setting", &SENTINEL).unwrap();
    db.save_map(&MapRecord {
        id: "map".into(),
        project_id: "p".into(),
        name: "港口".into(),
        width: 2,
        height: 2,
        tile_size: 16,
        layers: json!([{"tiles":[0,0,0,0],"visible":true}]),
        pins: json!([]),
        custom_tiles: json!([]),
        ..Default::default()
    })
    .unwrap();
    let initial_seq = db.last_change().unwrap();
    let mut c = Client::spawn(dir.path());
    for version in ["2024-11-05", "2025-03-26"] {
        let r = c.request("initialize", initialize(version));
        assert_eq!(r["protocolVersion"], version);
        assert_eq!(
            r["serverInfo"],
            json!({"name":"gameworkspace-mcp","version":env!("CARGO_PKG_VERSION")})
        );
    }
    c.send(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}).to_string());
    assert_eq!(c.request("ping", json!({})), json!({}));
    c.send("{");
    assert_eq!(c.receive()["error"]["code"], -32700);
    assert_eq!(
        c.request("tools/list", json!({}))["tools"]
            .as_array()
            .unwrap()
            .len(),
        23
    );
    assert_eq!(
        c.request("resources/templates/list", json!({}))["resourceTemplates"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(
        c.request("resources/list", json!({}))["resources"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
    for uri in [
        "gws://projects",
        "gws://project/p/overview",
        "gws://project/p/schema",
        "gws://project/p/export/markdown",
    ] {
        let v = c.request("resources/read", json!({"uri":uri}));
        assert_eq!(v["contents"][0]["uri"], uri);
        let body = v["contents"][0]["text"].as_str().unwrap();
        if uri.ends_with("/schema") {
            let schema: Value = serde_json::from_str(body).unwrap();
            assert_eq!(schema["entityTypes"].as_object().unwrap().len(), 17);
        } else {
            assert!(body.contains("桌面项目"));
        }
    }
    assert_eq!(
        c.call("list_projects", json!({}))[0]["stats"]["entities"],
        0
    );
    let project = c.call(
        "create_project",
        json!({"name":"第二个项目","genres":["探索"]}),
    );
    assert_eq!(
        db.get_project(project["id"].as_str().unwrap())
            .unwrap()
            .enabled_modules
            .len(),
        20
    );
    let item=c.call("create_entity",json!({"projectId":"p","entityType":"item","title":"灯塔透镜","tags":["光学"],"data":{"price":3,"rarity":"稀有"}}))["id"].clone();
    let raw = c.call(
        "create_entity",
        json!({"projectId":"p","entityType":"item","title":"水晶"}),
    )["id"]
        .clone();
    let quest = c.call(
        "create_entity",
        json!({"projectId":"p","entityType":"quest","title":"修复灯塔","data":{"giverId":raw}}),
    )["id"]
        .clone();
    let updated = c.call("update_entity", json!({"entityId":item,"data":{"price":4}}));
    assert_eq!(updated["data"], json!({"price":4,"rarity":"稀有"}));
    let replaced = c.call(
        "update_entity",
        json!({"entityId":item,"replaceData":true,"data":{"price":5}}),
    );
    assert_eq!(replaced["data"], json!({"price":5}));
    let found = c.call(
        "search_entities",
        json!({"projectId":"p","entityType":"item","query":"灯塔","limit":1}),
    );
    assert_eq!(found[0]["id"], item);
    assert_eq!(
        c.call(
            "list_entities",
            json!({"projectId":"p","tag":"光学","status":"","offset":0})
        )[0]["id"],
        item
    );
    c.call(
        "link_entities",
        json!({"projectId":"p","sourceId":quest,"targetId":item,"relationLabel":"奖励"}),
    );
    assert_eq!(
        c.call("get_entity", json!({"entityId":item}))["backlinks"][0]["sourceId"],
        quest
    );
    let graph = c.call("get_relationship_graph", json!({"projectId":"p"}));
    assert_eq!(graph["manualLinks"][0]["targetId"], item);
    assert_eq!(graph["fieldLinks"][0]["targetId"], raw);
    assert_eq!(
        c.call("get_quest_flowchart", json!({"questId":quest}))["valid"],
        false
    );
    let flow=c.call("update_quest_flowchart",json!({"questId":quest,"nodes":[{"id":"a","type":"start"},{"id":"b","type":"end"}],"edges":[{"from":"a","to":"b"}],"prerequisites":[]}));
    assert_eq!(flow["valid"], true);
    assert_eq!(flow["warnings"], json!([]));
    let recipe=c.call("upsert_crafting_recipe",json!({"projectId":"p","outputItemId":item,"outputQty":2,"ingredients":[{"itemId":raw,"qty":3}]}));
    assert_eq!(
        c.call("list_crafting_recipes", json!({"projectId":"p"}))[0]["id"],
        recipe["id"]
    );
    assert_eq!(
        c.call("list_maps", json!({"projectId":"p"}))[0]["id"],
        "map"
    );
    c.call(
        "upsert_map_pin",
        json!({"mapId":"map","label":"透镜","x":1,"y":0,"entityId":item}),
    );
    c.call(
        "update_map_tiles",
        json!({"mapId":"map","layerIndex":0,"edits":[{"x":1,"y":1,"tileId":3}]}),
    );
    let map = c.call("get_map", json!({"mapId":"map"}));
    assert_eq!(map["layers"][0]["tiles"], json!([0, 0, 0, 3]));
    assert_eq!(map["pins"][0]["entityId"], item);
    c.call(
        "log_time_entry",
        json!({"projectId":"p","durationSecs":300,"startedAt":"2026-01-01T12:00:00Z"}),
    );
    assert_eq!(
        c.call("get_project_overview", json!({"projectId":"p"}))["stats"]["seconds"],
        300
    );

    let ops = json!([{"operation":"update_entity","targetEntityId":item,"patch":{"title":"棱镜"}}]);
    let seq = db.last_change().unwrap();
    let preview = c.call(
        "batch_apply_changes",
        json!({"projectId":"p","operations":ops,"mode":"dry_run"}),
    );
    assert_eq!(preview["proposals"][0]["before"]["title"], "灯塔透镜");
    assert_eq!(preview["proposals"][0]["after"]["title"], "棱镜");
    assert_eq!(db.last_change().unwrap(), seq);
    let bad = json!([ops[0],{"operation":"update_entity","targetEntityId":"missing","patch":{"title":"无效"}}]);
    let failed=c.request("tools/call",json!({"name":"batch_apply_changes","arguments":{"projectId":"p","operations":bad,"mode":"apply"}}));
    assert_eq!(failed["isError"], true);
    assert_eq!(db.last_change().unwrap(), seq);
    let review = c.call(
        "batch_apply_changes",
        json!({"projectId":"p","operations":ops,"mode":"review","sessionSummary":"镜片校正"}),
    );
    assert_eq!(review["proposals"][0]["status"], "pending");
    assert_eq!(
        db.get_entity(item.as_str().unwrap()).unwrap().title,
        "灯塔透镜"
    );
    assert_eq!(db.list_ai_proposals("p").unwrap().len(), 1);
    let applied = c.call(
        "batch_apply_changes",
        json!({"projectId":"p","operations":ops,"mode":"apply"}),
    );
    let proposal = &applied["proposals"][0];
    assert_eq!(proposal["status"], "applied");
    assert_eq!(db.get_entity(item.as_str().unwrap()).unwrap().title, "棱镜");
    c.call("delete_entity", json!({"entityId":raw}));
    assert!(db
        .get_entity(raw.as_str().unwrap())
        .unwrap()
        .deleted_at
        .is_some());
    c.call("restore_entity", json!({"entityId":raw}));
    assert!(db
        .get_entity(raw.as_str().unwrap())
        .unwrap()
        .deleted_at
        .is_none());
    c.call(
        "upsert_crafting_recipe",
        json!({"projectId":"p","id":recipe["id"],"delete":true}),
    );
    assert!(db.list_recipes("p").unwrap().is_empty());
    assert!(db
        .changes_since(initial_seq)
        .unwrap()
        .iter()
        .all(|e| e.source == "mcp"));
    assert!(db
        .list_recent_changes(Some("mcp"), 50)
        .unwrap()
        .iter()
        .any(|e| e.entity_id == *item.as_str().unwrap()));
    db.rollback_ai_proposal(proposal["id"].as_str().unwrap())
        .unwrap();
    assert_eq!(
        db.get_entity(item.as_str().unwrap()).unwrap().title,
        "灯塔透镜"
    );
    db.apply_ai_proposal(review["proposals"][0]["id"].as_str().unwrap())
        .unwrap();
    assert_eq!(db.list_recent_changes(None, 1).unwrap()[0].source, "sqlite");
    let md = c.call(
        "export_agent_bundle",
        json!({"projectId":"p","format":"markdown"}),
    );
    assert!(md.as_str().unwrap().contains("棱镜"));
    for (format, name) in [
        ("markdown", "项目.md"),
        ("backup", "项目.gws.json"),
        ("zip", "项目.zip"),
    ] {
        let file = dir.path().join(name);
        let result = c.call(
            "export_agent_bundle",
            json!({"projectId":"p","format":format,"outputPath":file}),
        );
        let bytes = fs::read(&file).unwrap();
        assert_eq!(result["bytes"], bytes.len());
        assert_no_secret(&bytes);
        if format == "zip" {
            let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
            for i in 0..zip.len() {
                let mut entry = zip.by_index(i).unwrap();
                assert!(!entry.name().contains("secrets.bin"));
                let mut bytes = Vec::new();
                entry.read_to_end(&mut bytes).unwrap();
                assert_no_secret(&bytes);
            }
        }
    }
    let invalid=c.exchange("tools/call",json!({"name":"create_entity","arguments":{"projectId":"p","entityType":"item","title":"", "surprise":true}}));
    assert_eq!(invalid["error"]["code"], -32602);
    c.finish();
    assert!(!dir.path().join("ignored").exists());
}

#[tokio::test]
async fn streamable_http_auth_origin_notifications_and_shutdown() {
    let dir = tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    assert!(start_http_server(&db, "0.0.0.0:0".parse().unwrap(), None)
        .await
        .is_err());
    let server = start_http_server(
        &db,
        "127.0.0.1:0".parse().unwrap(),
        Some("test-token".into()),
    )
    .await
    .unwrap();
    let addr = server.addr;
    let url = format!("http://{addr}/mcp");
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let health: Value = client
        .get(format!("http://{addr}/health"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(health, json!({"ok":true,"server":"gameworkspace-mcp"}));
    let post = || {
        client
            .post(&url)
            .bearer_auth("test-token")
            .header("Accept", "application/json, text/event-stream")
    };
    assert_eq!(
        client
            .post(&url)
            .json(&rpc(1, "ping", json!({})))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        post()
            .header("Origin", "https://example.org")
            .json(&rpc(1, "ping", json!({})))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let options = client
        .request(reqwest::Method::OPTIONS, &url)
        .header("Origin", "http://localhost:3000")
        .send()
        .await
        .unwrap();
    assert_eq!(options.status(), 204);
    assert_eq!(
        options.headers()["access-control-allow-origin"],
        "http://localhost:3000"
    );
    let r: Value = post()
        .json(&rpc(2, "initialize", initialize("2025-03-26")))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
    let notification = post()
        .json(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
        .send()
        .await
        .unwrap();
    assert_eq!(notification.status(), 202);
    assert!(notification.bytes().await.unwrap().is_empty());
    let r: Value = post()
        .json(&tool("create_project", json!({"name":"HTTP 项目"})))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(content(r["result"].clone())["name"], "HTTP 项目");
    assert_eq!(db.list_recent_changes(None, 1).unwrap()[0].source, "mcp");
    let batch = json!([rpc(1,"ping",json!({})),{"jsonrpc":"2.0","method":"notifications/initialized"},rpc(3,"ping",json!({}))]);
    let replies: Value = post()
        .json(&batch)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(replies.as_array().unwrap().len(), 2);
    assert_eq!(
        client
            .get(&url)
            .bearer_auth("test-token")
            .send()
            .await
            .unwrap()
            .status(),
        405
    );
    server.stop().await.unwrap();
    assert!(tokio::net::TcpStream::connect(addr).await.is_err());
}
#[test]
fn cli_resolves_shared_data_directory_and_legacy_fallback() {
    let root = tempdir().unwrap();
    let roaming = root.path().join("roaming");
    let modern = roaming.join("com.gameworkspace.app");
    let legacy = roaming.join("studio.mino.desktop");
    let old_env = root.path().join("old override");
    let new_env = root.path().join("new override");
    let explicit = root.path().join("cli override");
    let run = |old: Option<&Path>, new: Option<&Path>, cli: Option<&Path>| {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_gameworkspace-mcp"));
        cmd.env("APPDATA", &roaming)
            .env_remove("GAMEWORKSPACE_DATA_DIR")
            .env_remove("MINO_STUDIO_DATA_DIR");
        if let Some(p) = old {
            cmd.env("MINO_STUDIO_DATA_DIR", p);
        }
        if let Some(p) = new {
            cmd.env("GAMEWORKSPACE_DATA_DIR", p);
        }
        if let Some(p) = cli {
            cmd.arg("--data-dir").arg(p);
        }
        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        writeln!(
            child.stdin.take().unwrap(),
            "{}",
            tool("list_projects", json!({}))
        )
        .unwrap();
        let out = child.wait_with_output().unwrap();
        assert!(out.status.success());
        let reply: Value = serde_json::from_slice(&out.stdout).unwrap();
        content(reply["result"].clone())
    };
    assert_eq!(
        run(Some(&old_env), Some(&new_env), Some(&explicit)),
        json!([])
    );
    assert!(explicit.join(DATABASE_NAME).is_file());
    assert_eq!(run(Some(&old_env), Some(&new_env), None), json!([]));
    assert!(new_env.join(DATABASE_NAME).is_file());
    assert!(!old_env.exists());
    assert_eq!(run(Some(&old_env), None, None), json!([]));
    assert!(old_env.join(DATABASE_NAME).is_file());
    assert!(!roaming.exists());
    setup(&Database::open(&legacy).unwrap());
    assert_eq!(run(None, None, None)[0]["id"], "p");
    assert!(!modern.exists());
    drop(Database::open(&modern).unwrap());
    assert_eq!(run(None, None, None), json!([]));
}

#[test]
fn wal_desktop_reads_during_two_hundred_agent_commits() {
    let dir = tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    setup(&db);
    let mcp = McpHandler::new(&db).unwrap();
    let (tx, rx) = mpsc::sync_channel(1);
    let writer = thread::spawn(move || {
        for i in 0..200 {
            let title = format!("灯塔档案 {i:03}");
            let r = mcp
                .handle_request(&tool(
                    "create_entity",
                    json!({"projectId":"p","entityType":"doc","title":title}),
                ))
                .unwrap();
            tx.send((i, title, content(r["result"].clone())["id"].clone()))
                .unwrap();
        }
    });
    let mut count = 0;
    for (i, title, id) in rx {
        assert_eq!(
            db.search_entities("p", &title, 1).unwrap()[0].id,
            id.as_str().unwrap()
        );
        let all = db.list_entities("p").unwrap();
        assert!(all.len() > i && all.iter().any(|e| e.id == id.as_str().unwrap()));
        count += 1;
    }
    writer.join().unwrap();
    assert_eq!(count, 200);
    assert_eq!(db.list_entities("p").unwrap().len(), 200);
}

#[test]
fn ten_thousand_entities_mcp_search_under_ten_ms() {
    let dir = tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    setup(&db);
    let conn = rusqlite::Connection::open(dir.path().join(DATABASE_NAME)).unwrap();
    conn.execute_batch("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<10000)
        INSERT INTO entities(id,project_id,entity_type,title,subtitle,summary,status,tags_json,body,data_json,sort_order,created_at,updated_at)
        SELECT 'doc-'||i,'p','doc','白岬灯塔航记 '||i,'','雾海航线','','[]','退潮后沿灯塔的光束找回白岬。','{}',i,'','' FROM n").unwrap();
    assert_eq!(db.workspace_stats().unwrap()[0].entities, 10000);
    let h = McpHandler::new(&db).unwrap();
    for q in ["雾", "灯塔", "白岬灯塔"] {
        let req = tool(
            "search_entities",
            json!({"projectId":"p","query":q,"limit":30}),
        );
        let mut times = Vec::new();
        for _ in 0..31 {
            let start = Instant::now();
            let r = h.handle_request(&req).unwrap();
            times.push(start.elapsed());
            assert_eq!(content(r["result"].clone()).as_array().unwrap().len(), 30);
        }
        times.sort();
        let median = times[times.len() / 2];
        eprintln!("MCP search {q} (10,000 entities, 31 samples): median {median:?}");
        assert!(median < Duration::from_millis(10), "{q}: {median:?}");
    }
}
