use crate::graph;
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{DateTime, TimeDelta, Utc};
use mino_core::{export, repo::now, *};
use serde_json::{json, Value};
use std::{collections::HashMap, io::Write, path::Path};
use uuid::Uuid;

fn id() -> String {
    Uuid::new_v4().to_string()
}
fn invalid(msg: &str) -> Error {
    Error::Invalid(msg.into())
}
fn s<'a>(a: &'a Value, k: &str) -> &'a str {
    a[k].as_str().unwrap_or_default()
}
fn yes(a: &Value, k: &str) -> bool {
    a[k] == true
}

pub fn projects(db: &Database) -> Result<Value> {
    let mut stats: HashMap<_, _> = db
        .workspace_stats()?
        .into_iter()
        .map(|s| (s.project_id.clone(), s))
        .collect();
    let rows = db
        .list_projects()?
        .into_iter()
        .map(|p| {
            let mut row = json!(p);
            row["stats"] = json!(stats.remove(&p.id));
            row
        })
        .collect();
    Ok(Value::Array(rows))
}
pub fn overview(db: &Database, project: &str) -> Result<Value> {
    let p = db.get_project(project)?;
    let entities = db.list_entities(project)?;
    let mut counts = HashMap::<_, usize>::new();
    let mut phases = Vec::new();
    let mut milestones = Vec::new();
    for e in &entities {
        *counts.entry(&e.entity_type).or_default() += 1;
        match e.entity_type.as_str() {
            "phase" => phases.push(e),
            "milestone" => milestones.push(e),
            _ => (),
        }
    }
    let mut recent = db.list_activity(project)?;
    recent.reverse();
    recent.truncate(20);
    let stats = db
        .workspace_stats()?
        .into_iter()
        .find(|s| s.project_id == project);
    Ok(
        json!({"project":p,"stats":stats,"phases":phases,"milestones":milestones,"entityCounts":counts,"recentActivity":recent}),
    )
}
fn active(db: &Database, id: &str) -> Result<Entity> {
    let row = db.get_entity(id)?;
    if row.deleted_at.is_some() {
        return Err(Error::Missing);
    }
    Ok(row)
}
fn require_quest(e: &Entity) -> Result<()> {
    if e.entity_type != "quest" || e.deleted_at.is_some() {
        return Err(invalid("需要有效的任务线 ID"));
    }
    Ok(())
}
fn patch(row: &mut Entity, a: &Value) -> Result<()> {
    let old_status = row.status.clone();
    for (key, field) in [
        ("title", &mut row.title),
        ("subtitle", &mut row.subtitle),
        ("summary", &mut row.summary),
        ("status", &mut row.status),
        ("body", &mut row.body),
    ] {
        if let Some(v) = a[key].as_str() {
            *field = v.into();
        }
    }
    if let Some(v) = a.get("tags") {
        row.tags = serde_json::from_value(v.clone())?;
    }
    if let Some(v) = a["data"].as_object() {
        if let Some(old) = row.data.as_object_mut().filter(|_| !yes(a, "replaceData")) {
            old.extend(v.clone());
        } else {
            row.data = Value::Object(v.clone());
        }
    }
    if row.entity_type == "task" && old_status != row.status {
        if row.status == "已完成" {
            if !row.data.is_object() {
                row.data = json!({});
            }
            if row.data["completedAt"].is_null() {
                row.data["completedAt"] = json!(now());
            }
        } else if let Some(d) = row.data.as_object_mut() {
            d.remove("completedAt");
        }
    }
    Ok(())
}

fn edit_map(db: &Database, name: &str, a: &Value) -> Result<Value> {
    let m = db.edit_map(s(a, "mapId"), a["entityId"].as_str(), |m| {
        let cell = |v: &Value| -> Result<usize> {
            let (x, y) = (v["x"].as_i64().unwrap_or(-1), v["y"].as_i64().unwrap_or(-1));
            if !(0..m.width).contains(&x) || !(0..m.height).contains(&y) {
                return Err(invalid("坐标超出地图"));
            }
            y.checked_mul(m.width)
                .and_then(|n| n.checked_add(x))
                .and_then(|i| usize::try_from(i).ok())
                .ok_or_else(|| invalid("地图尺寸无效"))
        };
        if name == "upsert_map_pin" {
            cell(a)?;
            if m.pins.is_null() {
                m.pins = json!([]);
            }
            let pins = m
                .pins
                .as_array_mut()
                .ok_or_else(|| invalid("无效图钉数据"))?;
            let at = pins
                .iter()
                .position(|p| p["x"] == a["x"] && p["y"] == a["y"]);
            if yes(a, "remove") {
                if let Some(i) = at {
                    pins.remove(i);
                }
            } else {
                let p = if let Some(i) = at {
                    &mut pins[i]
                } else {
                    pins.push(
                        json!({"id":id(),"color":"#ad5946","entityId":"","x":a["x"],"y":a["y"]}),
                    );
                    pins.last_mut().unwrap()
                };
                p["label"] = a["label"].clone();
                if let Some(e) = a.get("entityId") {
                    p["entityId"] = e.clone();
                }
            }
        } else {
            let index = a["layerIndex"].as_u64().unwrap() as usize;
            if index == 0 && (m.layers.is_null() || m.layers.as_array().is_some_and(Vec::is_empty))
            {
                m.layers = json!([{"name":"底图","visible":true,"tiles":[]}]);
            }
            let layer = m
                .layers
                .get_mut(index)
                .filter(|l| l.is_object())
                .ok_or_else(|| invalid("图层不存在"))?;
            if layer["tiles"].is_null() {
                layer["tiles"] = json!([]);
            }
            let tiles = layer["tiles"]
                .as_array_mut()
                .ok_or_else(|| invalid("图层数据无效"))?;
            for edit in a["edits"].as_array().unwrap() {
                let i = cell(edit)?;
                let tile = edit["tileId"].as_i64().unwrap();
                if tile > 19
                    && !m
                        .custom_tiles
                        .as_array()
                        .into_iter()
                        .flatten()
                        .enumerate()
                        .any(|(i, t)| t["id"].as_i64().unwrap_or(i as i64 + 20) == tile)
                {
                    return Err(invalid("图块 ID 不存在"));
                }
                if i >= tiles.len() {
                    tiles
                        .try_reserve(i + 1 - tiles.len())
                        .map_err(|_| invalid("地图过大"))?;
                    tiles.resize(i + 1, json!(0));
                }
                tiles[i] = json!(tile);
            }
        }
        Ok(())
    })?;
    Ok(json!(m))
}

fn bundle(db: &Database, p: &str, a: &Value) -> Result<Value> {
    let format = s(a, "format");
    let (bytes, suffix) = match format {
        "markdown" => (export::render_project_markdown(db, p)?.into_bytes(), ".md"),
        "zip" => (export::export_agent_bundle_zip(db, p)?, ".zip"),
        "backup" => (export::export_backup_gws_json(db, p)?, ".gws.json"),
        _ => return Err(invalid("未知导出格式")),
    };
    if let Some(output) = a["outputPath"].as_str() {
        let path = std::path::absolute(Path::new(output))?;
        if !path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.to_lowercase().ends_with(suffix))
        {
            return Err(invalid("输出路径扩展名与格式不符"));
        }
        let mut file =
            tempfile::NamedTempFile::new_in(path.parent().ok_or_else(|| invalid("无效路径"))?)?;
        file.write_all(&bytes)?;
        file.persist(&path).map_err(|e| e.error)?;
        Ok(json!({"path":path,"bytes":bytes.len()}))
    } else {
        match format {
            "markdown" => Ok(Value::String(
                String::from_utf8(bytes).expect("rendered UTF-8"),
            )),
            "backup" => Ok(serde_json::from_slice(&bytes)?),
            _ => Ok(json!({"encoding":"base64","bytes":bytes.len(),"data":STANDARD.encode(bytes)})),
        }
    }
}

pub fn call(db: &Database, name: &str, a: &Value) -> Result<Value> {
    let p = s(a, "projectId");
    let eid = s(a, "entityId");
    let limit = a["limit"].as_u64().unwrap_or(30) as u32;
    match name {
        "list_projects" => projects(db),
        "create_project" => {
            let mut row: Project = serde_json::from_value(a.clone())?;
            row.id = id();
            row.cover_preset = "lighthouse-v2".into();
            if !a["engine"].is_string() {
                row.engine = "Unity".into();
            }
            if !a["platforms"].is_array() {
                row.platforms = vec!["PC".into()];
            }
            row.enabled_modules="overview tasks roadmap calendar time docs lore art characters locations factions vehicles inventory collectibles quests scenes graph mapmaker testing devlog".split_whitespace().map(str::to_owned).collect();
            db.save_project(&row)?;
            Ok(json!(db.get_project(&row.id)?))
        }
        "get_project_overview" => overview(db, p),
        "search_entities" => Ok(json!(db.search_entities_filtered(
            p,
            s(a, "query"),
            a["entityType"].as_str(),
            limit
        )?)),
        "list_entities" => Ok(json!(db.entity_page(
            p,
            a["entityType"].as_str(),
            a["status"].as_str(),
            a["tag"].as_str(),
            limit,
            a["offset"].as_u64().unwrap_or(0) as u32
        )?)),
        "get_entity" => {
            let row = active(db, eid)?;
            let outgoing: Vec<_> = db
                .list_links(&row.project_id)?
                .into_iter()
                .filter(|l| l.source_id == eid)
                .collect();
            Ok(
                json!({"entity":row,"outgoingLinks":outgoing,"backlinks":db.backlinks(&row.project_id,eid)?}),
            )
        }
        "create_entity" => {
            let mut e = Entity {
                id: id(),
                project_id: p.into(),
                entity_type: s(a, "entityType").into(),
                data: json!({}),
                sort_order: Utc::now().timestamp_millis(),
                ..Default::default()
            };
            if e.entity_type == "task" {
                e.status = "待办".into();
            }
            patch(&mut e, a)?;
            db.save_entity(&e)?;
            Ok(json!(db.get_entity(&e.id)?))
        }
        "update_entity" => Ok(json!(db.edit_entity(eid, |row| patch(row, a))?)),
        "delete_entity" => {
            db.soft_delete(eid)?;
            Ok(json!({"deleted":eid}))
        }
        "restore_entity" => {
            db.restore(eid)?;
            Ok(json!(active(db, eid)?))
        }
        "link_entities" => {
            db.set_manual_link(
                &EntityLink {
                    id: id(),
                    project_id: p.into(),
                    source_id: s(a, "sourceId").into(),
                    target_id: s(a, "targetId").into(),
                    relation_label: s(a, "relationLabel").into(),
                    link_kind: "manual".into(),
                    created_at: now(),
                },
                yes(a, "remove"),
            )?;
            Ok(json!({"ok":true}))
        }
        "get_relationship_graph" => graph::relationships(db, p),
        "get_quest_flowchart" => {
            let q = active(db, s(a, "questId"))?;
            require_quest(&q)?;
            Ok(graph::flow(&q))
        }
        "update_quest_flowchart" => {
            let q = db.edit_entity(s(a, "questId"), |q| {
                require_quest(q)?;
                if !q.data.is_object() {
                    q.data = json!({});
                }
                for k in ["nodes", "edges", "prerequisites"] {
                    if let Some(v) = a.get(k) {
                        q.data[k] = v.clone();
                    }
                }
                Ok(())
            })?;
            Ok(graph::flow(&q))
        }
        "list_crafting_recipes" => Ok(json!(db.list_recipes(p)?)),
        "upsert_crafting_recipe" => {
            let mut recipe: CraftingRecipe = serde_json::from_value(a.clone())?;
            if recipe.id.is_empty() {
                recipe.id = id();
            }
            if recipe.tools.is_null() {
                recipe.tools = json!([]);
            }
            db.set_recipe(&recipe, yes(a, "delete"))?;
            if yes(a, "delete") {
                Ok(json!({"deleted":recipe.id}))
            } else {
                Ok(json!(db.get_recipe(&recipe.id)?))
            }
        }
        "list_maps" => Ok(json!(db.list_maps(p)?)),
        "get_map" => Ok(json!(db.get_map(s(a, "mapId"))?)),
        "upsert_map_pin" | "update_map_tiles" => edit_map(db, name, a),
        "log_time_entry" => {
            let secs = a["durationSecs"].as_i64().unwrap();
            let duration = TimeDelta::seconds(secs);
            let start = match a["startedAt"].as_str() {
                Some(v) => DateTime::parse_from_rfc3339(v)
                    .map_err(|_| invalid("startedAt 需要 RFC3339 格式"))?
                    .with_timezone(&Utc),
                None => Utc::now() - duration,
            };
            let end = start
                .checked_add_signed(duration)
                .ok_or_else(|| invalid("日期超出范围"))?;
            let task = a["taskId"].as_str();
            if let Some(t) = task {
                let e = active(db, t)?;
                if e.project_id != p || e.entity_type != "task" {
                    return Err(invalid("任务不属于此项目"));
                }
            }
            let row = TimeEntry {
                id: id(),
                project_id: p.into(),
                task_id: task.map(str::to_owned),
                started_at: start.to_rfc3339(),
                ended_at: Some(end.to_rfc3339()),
                duration_secs: secs,
                note: s(a, "note").into(),
                ..Default::default()
            };
            db.save_time_entry(&row)?;
            Ok(json!(db.get_time_entry(&row.id)?))
        }
        "batch_apply_changes" => {
            let mode = a["mode"].as_str().unwrap_or("dry_run");
            Ok(
                json!({"mode":mode,"proposals":db.proposal_batch(p,a["operations"].as_array().unwrap(),mode,a["sessionSummary"].as_str())?}),
            )
        }
        "export_agent_bundle" => bundle(db, p, a),
        _ => Err(invalid("未知工具")),
    }
}
