use mino_core::{assets::AssetInfo, *};
use std::sync::Arc;
use tauri::{
    ipc::{InvokeBody, Request},
    State,
};

type Db<'a> = State<'a, Arc<Database>>;
type Reply<T> = std::result::Result<T, String>;

#[derive(Default)]
pub struct McpService {
    server: tokio::sync::Mutex<Option<mino_mcp::HttpServer>>,
}

#[tauri::command]
pub async fn get_mcp_status(
    db: Db<'_>,
    service: State<'_, McpService>,
) -> Reply<serde_json::Value> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let companion = format!("gameworkspace-mcp{}", std::env::consts::EXE_SUFFIX);
    let adjacent = exe.with_file_name(&companion);
    let binary = if adjacent.is_file() {
        adjacent
    } else {
        let release = exe
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.join("release").join(&companion));
        release.filter(|p| p.is_file()).unwrap_or(adjacent)
    };
    let server = service.server.lock().await;
    let addr = server
        .as_ref()
        .filter(|s| !s.handle.is_finished())
        .map(|s| s.addr);
    Ok(
        serde_json::json!({"binaryPath":binary,"binaryExists":binary.is_file(),"dataDir":db.data_dir(),
        "dbPath":db.data_dir().join(DATABASE_NAME),"httpRunning":addr.is_some(),"httpPort":addr.map(|a|a.port()).unwrap_or(47890),
        "httpUrl":addr.map(|a|format!("http://{a}/mcp")),"recentChanges":db.list_recent_changes(Some("mcp"),50).map_err(|e|e.to_string())?,
        "directory":mino_mcp::directory()}),
    )
}
#[tauri::command]
pub async fn start_mcp_http(port: u16, db: Db<'_>, service: State<'_, McpService>) -> Reply<()> {
    if port == 0 {
        return Err("端口范围为 1–65535".into());
    }
    let mut server = service.server.lock().await;
    if let Some(running) = server.as_ref().filter(|s| !s.handle.is_finished()) {
        return if running.addr.port() == port {
            Ok(())
        } else {
            Err("请先停止正在运行的服务".into())
        };
    }
    *server = Some(
        mino_mcp::start_http_server(&db, ([127, 0, 0, 1], port).into(), None)
            .await
            .map_err(|e| e.to_string())?,
    );
    Ok(())
}
#[tauri::command]
pub async fn stop_mcp_http(service: State<'_, McpService>) -> Reply<()> {
    let mut guard = service.server.lock().await;
    if let Some(server) = guard.take() {
        server.stop().await.map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn test_mcp_self_check(db: Db<'_>) -> Reply<serde_json::Value> {
    mino_mcp::McpHandler::new(&db)
        .and_then(|h| h.self_check())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_projects(db: Db<'_>) -> Reply<Vec<Project>> {
    db.list_projects().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_project(db: Db<'_>, id: String) -> Reply<Project> {
    db.get_project(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_project(db: Db<'_>, project: Project) -> Reply<()> {
    db.save_project(&project).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn duplicate_project(db: Db<'_>, id: String) -> Reply<Project> {
    db.duplicate_project(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_project(db: Db<'_>, id: String) -> Reply<()> {
    db.delete_project(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_project(db: Db<'_>, id: String) -> Reply<Snapshot> {
    db.export_project(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn workspace_stats(db: Db<'_>) -> Reply<Vec<ProjectStats>> {
    db.workspace_stats().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_entities(db: Db<'_>, project_id: String) -> Reply<Vec<Entity>> {
    db.list_entities(&project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_entity(db: Db<'_>, id: String) -> Reply<Entity> {
    db.get_entity(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_entity(db: Db<'_>, entity: Entity) -> Reply<()> {
    db.save_entity(&entity).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_entity(db: Db<'_>, id: String) -> Reply<()> {
    db.soft_delete(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_entity(db: Db<'_>, id: String) -> Reply<()> {
    db.restore(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn recycle_bin(db: Db<'_>, project_id: Option<String>) -> Reply<Vec<Entity>> {
    db.recycle_bin(project_id.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_entities(
    db: Db<'_>,
    project_id: String,
    query: String,
    limit: u32,
) -> Reply<Vec<SearchResult>> {
    db.search_entities(&project_id, &query, limit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_links(db: Db<'_>, project_id: String) -> Reply<Vec<EntityLink>> {
    db.list_links(&project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_link(db: Db<'_>, link: EntityLink) -> Reply<()> {
    db.save_link(&link).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_link(db: Db<'_>, id: String) -> Reply<()> {
    db.delete_link(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn backlinks(db: Db<'_>, project_id: String, target: String) -> Reply<Vec<EntityLink>> {
    db.backlinks(&project_id, &target)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_setting(db: Db<'_>, key: String) -> Reply<Option<AppSettings>> {
    db.get_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_setting(db: Db<'_>, key: String, value: serde_json::Value) -> Reply<()> {
    db.save_setting(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_setting(db: Db<'_>, key: String) -> Reply<()> {
    db.delete_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_time_entries(db: Db<'_>, project_id: String) -> Reply<Vec<TimeEntry>> {
    db.list_time_entries(&project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_time_entry(db: Db<'_>, record: TimeEntry) -> Reply<()> {
    db.save_time_entry(&record).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_time_entry(db: Db<'_>, id: String) -> Reply<()> {
    db.delete_time_entry(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_activity(db: Db<'_>, project_id: String) -> Reply<Vec<ActivityLog>> {
    db.list_activity(&project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_activity(db: Db<'_>, record: ActivityLog) -> Reply<()> {
    db.save_activity(&record).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_activity(db: Db<'_>, id: String) -> Reply<()> {
    db.delete_activity(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_maps(db: Db<'_>, project_id: String) -> Reply<Vec<MapRecord>> {
    db.list_maps(&project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_map(db: Db<'_>, record: MapRecord) -> Reply<()> {
    db.save_map(&record).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_map(db: Db<'_>, id: String) -> Reply<()> {
    db.delete_map(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_recipes(db: Db<'_>, project_id: String) -> Reply<Vec<CraftingRecipe>> {
    db.list_recipes(&project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_recipe(db: Db<'_>, record: CraftingRecipe) -> Reply<()> {
    db.save_recipe(&record).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_recipe(db: Db<'_>, id: String) -> Reply<()> {
    db.delete_recipe(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_asset(db: Db<'_>, request: Request<'_>) -> Reply<AssetInfo> {
    let ext = request
        .headers()
        .get("x-mino-extension")
        .and_then(|h| h.to_str().ok())
        .ok_or("缺少文件类型")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("需要二进制文件".into());
    };
    db.save_asset(bytes, ext).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn parse_tabular_file(bytes: Vec<u8>, filename: String) -> Reply<tabular::Table> {
    tauri::async_runtime::spawn_blocking(move || tabular::parse(&bytes, &filename))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_entity_batch(
    db: Db<'_>,
    entities: Vec<Entity>,
    links: Vec<EntityLink>,
    restore: Option<Vec<String>>,
    trash: Option<Vec<String>>,
) -> Reply<()> {
    db.apply_entity_edits(
        &entities,
        &links,
        &restore.unwrap_or_default(),
        &trash.unwrap_or_default(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_providers() -> Vec<ai::AiProviderConfig> {
    ai::providers()
}
#[tauri::command]
pub fn list_api_key_status(db: Db<'_>) -> Reply<Vec<secrets::ApiKeyStatus>> {
    db.list_api_key_status().map_err(err)
}
#[tauri::command]
pub fn set_api_key(db: Db<'_>, provider_id: String, api_key: String) -> Reply<()> {
    db.set_api_key(&provider_id, &api_key).map_err(err)
}
#[tauri::command]
pub fn delete_api_key(db: Db<'_>, provider_id: String) -> Reply<()> {
    db.delete_api_key(&provider_id).map_err(err)
}
#[tauri::command]
pub async fn test_ai_connection(
    db: Db<'_>,
    config: ai::AiProviderConfig,
) -> Reply<ai::ConnectionTest> {
    Ok(db.test_connection(&config).await)
}
#[tauri::command]
pub async fn ai_chat_send(
    app: tauri::AppHandle,
    db: Db<'_>,
    input: ai::ChatRequest,
    request_id: String,
) -> Reply<AiMessage> {
    use tauri::Emitter;
    db.ai_chat_send(&input,|delta|{
        if input.mode==ai::Mode::Ask {let _=app.emit("gws://ai-stream",serde_json::json!({"projectId":input.project_id,"requestId":request_id,"delta":delta}));}
    }).await.map_err(err)
}
#[tauri::command]
pub async fn ai_assist_action(
    app: tauri::AppHandle,
    db: Db<'_>,
    input: ai::ChatRequest,
    request_id: String,
) -> Reply<AiMessage> {
    ai_chat_send(app, db, input, request_id).await
}
#[tauri::command]
pub fn list_ai_messages(db: Db<'_>, project_id: String) -> Reply<Vec<AiMessage>> {
    db.list_ai_messages(&project_id).map_err(err)
}
#[tauri::command]
pub fn list_ai_proposals(db: Db<'_>, project_id: String) -> Reply<Vec<AiProposal>> {
    db.list_ai_proposals(&project_id).map_err(err)
}
#[tauri::command]
pub fn clear_ai_session(db: Db<'_>, project_id: String) -> Reply<()> {
    db.clear_ai_session(&project_id).map_err(err)
}
#[tauri::command]
pub fn review_ai_proposals(db: Db<'_>, proposal_ids: Vec<String>, accept: bool) -> Reply<()> {
    db.review_ai_proposals(&proposal_ids, accept).map_err(err)
}
#[tauri::command]
pub fn apply_ai_proposal(db: Db<'_>, proposal_id: String) -> Reply<()> {
    db.apply_ai_proposal(&proposal_id).map_err(err)
}
#[tauri::command]
pub fn reject_ai_proposal(db: Db<'_>, proposal_id: String) -> Reply<()> {
    db.reject_ai_proposal(&proposal_id).map_err(err)
}
#[tauri::command]
pub fn rollback_ai_proposal(db: Db<'_>, proposal_id: String) -> Reply<()> {
    db.rollback_ai_proposal(&proposal_id).map_err(err)
}

fn err(e: mino_core::Error) -> String {
    e.to_string()
}
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> mino_core::Result<T> + Send + 'static,
) -> Reply<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
        .map_err(err)
}
#[tauri::command]
pub async fn parse_import_file(
    bytes: Vec<u8>,
    filename: String,
    mode: importer::ImportMode,
) -> Reply<importer::Preview> {
    blocking(move || importer::parse_import_file(&bytes, &filename, mode)).await
}
#[tauri::command]
pub async fn ai_parse_import(
    db: Db<'_>,
    project_id: String,
    mode: importer::ImportMode,
    raw_text: String,
    config: ai::AiProviderConfig,
) -> Reply<Vec<importer::Candidate>> {
    importer::ai_parse_import_candidates(&db, &project_id, mode, &raw_text, &config)
        .await
        .map_err(err)
}
#[tauri::command]
pub async fn commit_import_batch(
    db: Db<'_>,
    project_id: String,
    candidates: Vec<importer::Candidate>,
) -> Reply<importer::ImportBatch> {
    let db = db.inner().clone();
    blocking(move || db.commit_import_batch(&project_id, &candidates)).await
}
#[tauri::command]
pub fn undo_import_batch(db: Db<'_>, created_ids: Vec<String>) -> Reply<()> {
    db.undo_import_batch(&created_ids).map_err(err)
}
#[tauri::command]
pub async fn export_project_markdown(db: Db<'_>, project_id: String) -> Reply<String> {
    let db = db.inner().clone();
    blocking(move || export::render_project_markdown(&db, &project_id)).await
}
#[tauri::command]
pub async fn export_project_zip(db: Db<'_>, project_id: String) -> Reply<tauri::ipc::Response> {
    let db = db.inner().clone();
    blocking(move || export::export_agent_bundle_zip(&db, &project_id))
        .await
        .map(tauri::ipc::Response::new)
}
#[tauri::command]
pub async fn export_project_backup(db: Db<'_>, project_id: String) -> Reply<tauri::ipc::Response> {
    let db = db.inner().clone();
    blocking(move || export::export_backup_gws_json(&db, &project_id))
        .await
        .map(tauri::ipc::Response::new)
}
#[tauri::command]
pub async fn export_all_backups(db: Db<'_>) -> Reply<tauri::ipc::Response> {
    let db = db.inner().clone();
    blocking(move || export::export_all_projects_backup(&db))
        .await
        .map(tauri::ipc::Response::new)
}
#[tauri::command]
pub async fn import_backup_bytes(db: Db<'_>, bytes: Vec<u8>) -> Reply<Vec<Project>> {
    let db = db.inner().clone();
    blocking(move || export::import_backup_json(&db, &bytes)).await
}
