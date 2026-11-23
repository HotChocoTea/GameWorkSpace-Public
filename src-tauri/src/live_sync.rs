use mino_core::Database;
use std::{sync::Arc, time::Duration};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeNotice {
    seq: i64,
    external_mcp_count: usize,
    latest_summary: String,
}

pub async fn watch(db: Arc<Database>, mut seen: i64, mut emit: impl FnMut(ChangeNotice) -> bool) {
    let mut interval = tokio::time::interval(Duration::from_millis(300));
    loop {
        interval.tick().await;
        let Ok(entries) = db.changes_since(seen) else {
            continue;
        };
        let Some(last) = entries.last() else { continue };
        let external = entries.iter().filter(|e| e.source == "mcp");
        let latest = external.clone().next_back().unwrap_or(last);
        let notice = ChangeNotice {
            seq: last.seq,
            external_mcp_count: external.count(),
            latest_summary: format!(
                "{} · {} · {}",
                latest.action, latest.entity_type, latest.entity_id
            ),
        };
        if emit(notice) {
            seen = last.seq;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mino_mcp::McpHandler;
    use serde_json::json;
    use std::time::Instant;

    #[tokio::test]
    async fn desktop_watcher_detects_agent_commit_and_distinguishes_local_writes() {
        let temp = tempfile::tempdir().unwrap();
        let db = Arc::new(Database::open(temp.path()).unwrap());
        let agent = McpHandler::new(&db).unwrap();
        let (tx, mut events) = tokio::sync::mpsc::unbounded_channel();
        let watcher = tokio::spawn(watch(db.clone(), db.last_change().unwrap(), move |e| {
            tx.send(e).is_ok()
        }));
        db.save_setting("local", &true).unwrap();
        let local = tokio::time::timeout(Duration::from_secs(2), events.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(local.external_mcp_count, 0);

        let start = Instant::now();
        let response = agent
            .handle_request(&json!({"jsonrpc":"2.0","id":1,"method":"tools/call",
            "params":{"name":"create_project","arguments":{"name":"同步检查"}}}))
            .unwrap();
        assert_eq!(response["result"]["isError"], false);
        let change = tokio::time::timeout(Duration::from_secs(2), events.recv())
            .await
            .unwrap()
            .unwrap();
        eprintln!(
            "Desktop watcher observed external commit in {:?}",
            start.elapsed()
        );
        let payload = serde_json::to_value(change).unwrap();
        assert_eq!(payload["externalMcpCount"], 1);
        assert_eq!(payload["seq"], db.last_change().unwrap());
        assert!(payload["latestSummary"]
            .as_str()
            .unwrap()
            .contains("projects"));
        let check = agent.self_check().unwrap();
        assert_eq!(check["ok"], true);
        assert_eq!(check["toolCount"], 23);
        assert_eq!(check["resourceCount"], 4);
        assert_eq!(check["projectCount"], 1);
        watcher.abort();
        let _ = watcher.await;
    }
}
