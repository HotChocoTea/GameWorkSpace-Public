#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod asset_protocol;
mod commands;
mod live_sync;
mod save_dialog;
use commands::*;
use gws_core::{seeder::seed_sample_project_if_empty, Database};
use std::sync::Arc;
use tauri::{http::Response, Emitter, Manager};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let mut args = std::env::args_os().skip(1);
            let cli = if args.any(|arg| arg == "--data-dir") {
                Some(std::path::PathBuf::from(
                    args.next().ok_or("--data-dir requires a path")?,
                ))
            } else {
                None
            };
            let data_dir = gws_core::resolve_data_dir(cli.as_deref())?;
            let db = Arc::new(Database::open(&data_dir)?);
            seed_sample_project_if_empty(&db)?;
            db.purge_expired()?;
            let snapshot_db = db.clone();
            tauri::async_runtime::spawn_blocking(move || {
                if let Err(error) = gws_core::snapshots::daily_snapshot(&snapshot_db) {
                    eprintln!("每日快照失败：{error}");
                }
            });
            let seen = db.last_change()?;
            app.manage(McpService::default());
            app.manage(db.clone());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(live_sync::watch(db, seen, move |payload| {
                handle.emit("gws://db-changed", payload).is_ok()
            }));
            Ok(())
        })
        .register_uri_scheme_protocol("gws-asset", |ctx, request| {
            let db = ctx.app_handle().state::<Arc<Database>>();
            let name = request.uri().path().trim_start_matches('/');
            match db
                .resolve_asset_path(name)
                .and_then(|path| Ok(asset_protocol::serve(&path, name, &request)?))
            {
                Ok(response) => response,
                Err(_) => Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .expect("static status"),
            }
        })
        .invoke_handler(tauri::generate_handler![
            active_data_dir,
            evaluate_balance_curve,
            simulate_drop_table,
            extract_project_localization,
            ai_translate_localization,
            save_locale_translation,
            migrate_data_dir,
            open_data_dir_in_explorer,
            create_snapshot,
            list_snapshots,
            restore_snapshot,
            analyze_entity_impact,
            sync_project_to_engine,
            get_mcp_status,
            start_mcp_http,
            stop_mcp_http,
            test_mcp_self_check,
            ai_providers,
            list_api_key_status,
            set_api_key,
            delete_api_key,
            test_ai_connection,
            fetch_ai_models,
            ai_chat_send,
            ai_assist_action,
            list_ai_messages,
            list_ai_proposals,
            clear_ai_session,
            review_ai_proposals,
            apply_ai_proposal,
            reject_ai_proposal,
            rollback_ai_proposal,
            parse_import_file,
            ai_parse_import,
            commit_import_batch,
            undo_import_batch,
            export_project_markdown,
            export_project_zip,
            export_project_backup,
            export_all_backups,
            import_backup_bytes,
            parse_tabular_file,
            save_entity_batch,
            list_projects,
            get_project,
            save_project,
            duplicate_project,
            delete_project,
            export_project,
            workspace_stats,
            list_entities,
            get_entity,
            save_entity,
            delete_entity,
            restore_entity,
            recycle_bin,
            search_entities,
            list_links,
            save_link,
            delete_link,
            backlinks,
            get_setting,
            save_setting,
            delete_setting,
            list_time_entries,
            save_time_entry,
            delete_time_entry,
            list_activity,
            save_activity,
            delete_activity,
            list_maps,
            save_map,
            save_export_file,
            export_map_tiled_file,
            delete_map,
            list_recipes,
            save_recipe,
            delete_recipe,
            save_asset
        ])
        .run(tauri::generate_context!())
        .expect("GameWorkSpace startup failed")
}
