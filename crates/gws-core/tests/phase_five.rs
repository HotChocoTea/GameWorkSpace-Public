use gws_core::{ai::*, export::*, importer::*, seeder::seed_sample_project_if_empty, *};
use serde_json::{json, Value};
use std::io::{Cursor, Read, Write};
mod common;
use common::server;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

fn fixture() -> (tempfile::TempDir, Database) {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    seed_sample_project_if_empty(&db).unwrap();
    (dir, db)
}
#[cfg(windows)]
#[tokio::test]
async fn provider_headers_review_auto_rollback_and_atomic_failure() {
    let (_dir, db) = fixture();
    let original = db.get_entity("character-1").unwrap();
    for mode in [Mode::Review, Mode::Auto] {
        let anthropic = mode == Mode::Auto;
        let mut config = providers()
            .into_iter()
            .find(|c| c.id == if anthropic { "anthropic" } else { "openai" })
            .unwrap();
        db.set_api_key(&config.id, "sk-local-mock-key").unwrap();
        let ops = json!([{"operation":"update_entity","targetEntityId":original.id,"patch":{"summary":"设计修订","data":{"role":"导师"}}},{"operation":"create_entity","entityType":"doc","title":"交接说明"}]);
        let reply = json!({"reply":"两项修改","operations":ops}).to_string();
        let response = if anthropic {
            json!({"content":[{"type":"tool_use","name":"propose_changes","input":serde_json::from_str::<Value>(&reply).unwrap()}]})
        } else {
            json!({"choices":[{"message":{"content":reply}}]})
        };
        let (url, request) = server(response.to_string(), false).await;
        config.base_url = url;
        let mut input = ChatRequest {
            project_id: original.project_id.clone(),
            module: "characters".into(),
            scope: ScopeMode::Module,
            focused_id: Some(original.id.clone()),
            prompt: "调整定位".into(),
            mode,
            config,
            attachments: vec![],
        };
        let message = db.ai_chat_send(&input, |_| {}).await.unwrap();
        let raw = request.await.unwrap();
        let headers = raw.split("\r\n\r\n").next().unwrap().to_lowercase();
        assert!(headers.contains(if anthropic {
            "x-api-key: sk-local-mock-key"
        } else {
            "authorization: bearer sk-local-mock-key"
        }));
        assert!(raw.contains("调整定位") && raw.contains(&original.id));
        let ids = message.proposals.as_array().unwrap();
        let update = ids[0].as_str().unwrap();
        let create = ids[1].as_str().unwrap();
        if mode == Mode::Review {
            assert_eq!(db.get_entity(&original.id).unwrap(), original);
            db.apply_ai_proposal(update).unwrap();
            db.reject_ai_proposal(create).unwrap();
            assert!(db.apply_ai_proposal(create).is_err());
        } else {
            assert_eq!(
                db.list_ai_proposals(&original.project_id)
                    .unwrap()
                    .into_iter()
                    .find(|p| p.id == create)
                    .unwrap()
                    .status,
                "applied"
            );
            db.rollback_ai_proposal(create).unwrap();
        }
        assert_eq!(db.get_entity(&original.id).unwrap().summary, "设计修订");
        db.rollback_ai_proposal(update).unwrap();
        let restored = db.get_entity(&original.id).unwrap();
        assert_eq!(restored, original);
        if anthropic {
            let broken=json!({"reply":"错误事务","operations":[ops[0],{"operation":"delete_entity","targetEntityId":"absent"}]}).to_string();
            let (url, req) = server(json!({"content":[{"text":broken}]}).to_string(), false).await;
            input.config.base_url = url;
            assert!(db.ai_chat_send(&input, |_| {}).await.is_err());
            req.await.unwrap();
            assert_eq!(db.get_entity(&original.id).unwrap(), restored);
        }
    }
    assert_eq!(db.list_ai_messages("lightward").unwrap().len(), 4);
}
#[tokio::test]
async fn streaming_ask_preserves_unicode_and_ignores_operations() {
    let (_dir, db) = fixture();
    for provider in ["ollama", "anthropic"] {
        let mut config = providers().into_iter().find(|c| c.id == provider).unwrap();
        config.requires_key = false;
        let frames = if provider == "ollama" {
            vec![
                json!({"choices":[{"delta":{"content":"你好"}}]}).to_string(),
                "[DONE]".into(),
            ]
        } else {
            vec![
                json!({"type":"content_block_delta","delta":{"text":"你好"}}).to_string(),
                json!({"type":"message_stop"}).to_string(),
            ]
        };
        let (url, req) = server(
            frames.iter().map(|s| format!("data: {s}\n\n")).collect(),
            true,
        )
        .await;
        config.base_url = url;
        let input = ChatRequest {
            project_id: "lightward".into(),
            module: "overview".into(),
            scope: ScopeMode::Module,
            focused_id: None,
            prompt: "介绍".into(),
            config,
            mode: Mode::Ask,
            attachments: vec![],
        };
        let mut stream = String::new();
        let msg = db
            .ai_chat_send(&input, |s| stream.push_str(s))
            .await
            .unwrap();
        req.await.unwrap();
        assert_eq!(stream, "你好");
        assert_eq!(msg.content, stream);
        assert!(db.list_ai_proposals("lightward").unwrap().is_empty());
    }
    db.clear_ai_session("lightward").unwrap();
    assert!(db.list_ai_messages("lightward").unwrap().is_empty());
}
#[test]
fn offline_docx_markdown_csv_commit_and_undo() {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let opts = SimpleFileOptions::default();
    for (path, content) in [
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
        ),
        (
            "_rels/.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#,
        ),
        (
            "word/document.xml",
            r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>角色</w:t></w:r></w:p><w:p><w:r><w:t>守卫：沉默的配角</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>物品名</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>价格</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>铜钥匙</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#,
        ),
    ] {
        zip.start_file(path, opts).unwrap();
        zip.write_all(content.as_bytes()).unwrap();
    }
    let doc = parse_import_file(
        &zip.finish().unwrap().into_inner(),
        "设计.docx",
        ImportMode::Design,
    )
    .unwrap();
    assert!(doc.raw_text.contains("## 角色"));
    assert_eq!(doc.candidates.len(), 2);
    assert_eq!(doc.candidates[0].entity_type, "character");
    assert_eq!(doc.candidates[1].data["price"], 5.0);
    let md = parse_import_file(
        "# 支线任务\n- 归途：寻找信使".as_bytes(),
        "计划.md",
        ImportMode::Design,
    )
    .unwrap();
    assert_eq!(md.candidates[0].data["category"], "支线");
    let csv = parse_import_file(
        "标题,说明\n读档崩溃,打开菜单".as_bytes(),
        "issues.csv",
        ImportMode::Bugs,
    )
    .unwrap();
    assert_eq!(csv.candidates[0].data["severity"], "致命");
    let (_dir, db) = fixture();
    let batch = db
        .commit_import_batch("lightward", &doc.candidates)
        .unwrap();
    assert_eq!(batch.created_ids.len(), 2);
    db.undo_import_batch(&batch.created_ids).unwrap();
    for id in batch.created_ids {
        assert!(db.get_entity(&id).unwrap().deleted_at.is_some());
    }
}
#[test]
fn portable_backup_collision_and_agent_bundle() {
    let (_dir, db) = fixture();
    let asset = db.save_asset(b"custom binary\0\xff", "bin").unwrap();
    let mut project = db.get_project("lightward").unwrap();
    project.logo_asset = Some(asset.filename.clone());
    db.save_project(&project).unwrap();
    #[cfg(windows)]
    db.set_api_key("openai", "sk-test-never-export-this")
        .unwrap();
    let original = db.export_project(&project.id).unwrap();
    let bytes = export_backup_gws_json(&db, &project.id).unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("sk-test-never-export-this"));
    let dest = tempfile::tempdir().unwrap();
    let fresh = Database::open(dest.path()).unwrap();
    let projects = import_backup_json(&fresh, &bytes).unwrap();
    assert_eq!(projects[0].id, project.id);
    assert_eq!(
        json!(fresh.export_project(&project.id).unwrap()),
        json!(original)
    );
    assert_eq!(
        std::fs::read(fresh.resolve_asset_path(&asset.filename).unwrap()).unwrap(),
        b"custom binary\0\xff"
    );
    let copy = import_backup_json(&fresh, &bytes).unwrap().remove(0);
    assert_ne!(copy.id, project.id);
    let snapshot = fresh.export_project(&copy.id).unwrap();
    assert_eq!(snapshot.entities.len(), original.entities.len());
    assert_eq!(snapshot.maps.len(), original.maps.len());
    assert_eq!(snapshot.recipes.len(), original.recipes.len());
    for link in snapshot.links {
        assert_eq!(
            fresh.get_entity(&link.source_id).unwrap().project_id,
            copy.id
        );
        assert_eq!(
            fresh.get_entity(&link.target_id).unwrap().project_id,
            copy.id
        )
    }
    assert_eq!(
        json!(fresh.export_project(&project.id).unwrap()),
        json!(original)
    );
    let mut zip = ZipArchive::new(Cursor::new(
        export_agent_bundle_zip(&db, &project.id).unwrap(),
    ))
    .unwrap();
    let names: Vec<_> = zip.file_names().map(String::from).collect();
    assert!(names
        .iter()
        .any(|n| n.starts_with("maps/") && n.ends_with(".json")));
    for name in names {
        let mut content = Vec::new();
        zip.by_name(&name)
            .unwrap()
            .read_to_end(&mut content)
            .unwrap();
        assert!(!String::from_utf8_lossy(&content).contains("sk-test-never-export-this"));
        if name == "data.json" {
            assert_eq!(
                serde_json::from_slice::<Value>(&content).unwrap(),
                json!(original)
            )
        }
    }
    for name in [
        "README.md",
        "设计文档.md",
        "data.json",
        "maps/",
        "assets/",
        &format!("assets/{}", asset.filename),
    ] {
        assert!(zip.by_name(name).is_ok())
    }
    let all = export_all_projects_backup(&fresh).unwrap();
    assert_eq!(import_backup_json(&db, &all).unwrap().len(), 2);
    assert_eq!(
        import_backup_json(&db, &serde_json::to_vec(&original).unwrap())
            .unwrap()
            .len(),
        1
    );
}
#[cfg(windows)]
#[tokio::test]
async fn echoed_credentials_never_reach_stream_or_chat_history() {
    let (_dir, db) = fixture();
    let key = "sk-private-stream-secret";
    let mut config = providers().into_iter().find(|c| c.id == "openai").unwrap();
    db.set_api_key("openai", key).unwrap();
    let frames = ["安全的前缀 sk-pri", "vate-stream-secret"]
        .map(|part| {
            format!(
                "data: {}\n\n",
                json!({"choices":[{"delta":{"content":part}}]})
            )
        })
        .join("");
    let (url, req) = server(frames + "data: [DONE]\n\n", true).await;
    config.base_url = url;
    let input = ChatRequest {
        project_id: "lightward".into(),
        module: "overview".into(),
        scope: ScopeMode::Module,
        focused_id: None,
        prompt: "测试".into(),
        mode: Mode::Ask,
        config,
        attachments: vec![],
    };
    let mut received = String::new();
    assert!(db
        .ai_chat_send(&input, |part| received.push_str(part))
        .await
        .is_err());
    req.await.unwrap();
    assert_eq!(received, "安全的前缀 ");
    assert!(db.list_ai_messages("lightward").unwrap().is_empty());
}
#[tokio::test]
async fn connection_tool_calls_import_and_conflict_detection() {
    let (_dir, db) = fixture();
    let mut config = providers().into_iter().find(|c| c.id == "custom").unwrap();
    config.requires_key = false;
    config.model = "test".into();
    let (url, req) = server(r#"{"data":[]}"#.into(), false).await;
    config.base_url = url;
    assert!(db.test_connection(&config).await.ok);
    assert!(req.await.unwrap().starts_with("GET /models "));
    let candidate = json!([{"entityType":"bug","title":"卡住","data":{"severity":"严重"}}]);
    let (url, req) = server(
        json!({"choices":[{"message":{"content":candidate.to_string()}}]}).to_string(),
        false,
    )
    .await;
    config.base_url = url;
    let extracted =
        ai_parse_import_candidates(&db, "lightward", ImportMode::Bugs, "在门口卡住", &config)
            .await
            .unwrap();
    assert_eq!(extracted[0].entity_type, "bug");
    assert!(req.await.unwrap().contains("在门口卡住"));
    let original = db.get_entity("character-1").unwrap();
    let args = json!({"reply":"计划变更","operations":[{"operation":"create_link","sourceId":"character-1","targetId":"location-1","relationLabel":"驻守"},{"operation":"delete_entity","targetEntityId":"character-1"}]});
    let(url,req)=server(json!({"choices":[{"message":{"tool_calls":[{"function":{"name":"propose_changes","arguments":args.to_string()}}]}}]}).to_string(),false).await;
    config.base_url = url;
    config.id = "openai".into();
    let input = ChatRequest {
        project_id: "lightward".into(),
        module: "characters".into(),
        scope: ScopeMode::Module,
        focused_id: None,
        prompt: "规划变更".into(),
        mode: Mode::Review,
        config,
        attachments: vec![],
    };
    let message = db.ai_chat_send(&input, |_| {}).await.unwrap();
    assert!(req.await.unwrap().contains("tool_choice"));
    let ids = message.proposals.as_array().unwrap();
    let link = ids[0].as_str().unwrap();
    let delete = ids[1].as_str().unwrap();
    let count = db.list_links("lightward").unwrap().len();
    db.apply_ai_proposal(link).unwrap();
    assert_eq!(db.list_links("lightward").unwrap().len(), count + 1);
    db.rollback_ai_proposal(link).unwrap();
    assert_eq!(db.list_links("lightward").unwrap().len(), count);
    let save = export_backup_gws_json(&db, "lightward").unwrap();
    let copy = import_backup_json(&db, &save).unwrap().remove(0);
    let copied = db
        .list_ai_proposals(&copy.id)
        .unwrap()
        .into_iter()
        .find(|p| p.operation == "delete_entity")
        .unwrap();
    db.apply_ai_proposal(&copied.id).unwrap();
    db.rollback_ai_proposal(&copied.id).unwrap();
    assert_eq!(db.get_entity("character-1").unwrap(), original);
    let mut edited = original;
    edited.summary = "人工修改".into();
    db.save_entity(&edited).unwrap();
    assert!(db.apply_ai_proposal(delete).is_err());
    assert_eq!(db.get_entity(&edited.id).unwrap().summary, "人工修改");
}

#[test]
fn invalid_multi_backup_is_atomic_and_legacy_collections_are_optional() {
    let (_dir, db) = fixture();
    let mut valid: Value =
        serde_json::from_slice(&export_backup_gws_json(&db, "lightward").unwrap()).unwrap();
    let mut broken = valid.clone();
    broken["snapshot"]["links"][0]["sourceId"] = json!("invalid-source");
    assert!(import_backup_json(
        &db,
        &serde_json::to_vec(
            &json!({"format":"gameworkspace-backup-all","version":1,"projects":[valid,broken]})
        )
        .unwrap()
    )
    .is_err());
    assert_eq!(db.list_projects().unwrap().len(), 1);
    let dest = tempfile::tempdir().unwrap();
    let fresh = Database::open(dest.path()).unwrap();
    valid["embeddedAssets"] = json!({});
    assert!(import_backup_json(&fresh, &serde_json::to_vec(&valid).unwrap()).is_err());
    assert!(fresh.list_projects().unwrap().is_empty());
    let old =
        json!({"project":valid["snapshot"]["project"],"entities":valid["snapshot"]["entities"]});
    assert_eq!(
        import_backup_json(&fresh, &serde_json::to_vec(&old).unwrap())
            .unwrap()
            .len(),
        1
    );
}
