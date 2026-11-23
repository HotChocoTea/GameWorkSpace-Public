use crate::{
    repo::{insert_exact, now, remap_references, Record},
    *,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    fs,
    io::{Cursor, Write},
};
use uuid::Uuid;
use zip::{write::SimpleFileOptions, ZipWriter};

const FORMAT: &str = "gameworkspace-backup";
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Backup {
    format: String,
    version: u32,
    #[serde(default)]
    exported_at: String,
    snapshot: Snapshot,
    #[serde(default)]
    embedded_assets: BTreeMap<String, String>,
}
fn asset_names(v: &Value, names: &mut BTreeSet<String>) {
    match v {
        Value::Array(a) => a.iter().for_each(|x| asset_names(x, names)),
        Value::Object(o) => o.values().for_each(|x| asset_names(x, names)),
        Value::String(s)
            if s.split_once('.').is_some_and(|(hash, ext)| {
                hash.len() == 64
                    && hash.bytes().all(|b| b.is_ascii_hexdigit())
                    && !ext.is_empty()
                    && ext.len() <= 10
                    && ext.bytes().all(|b| b.is_ascii_alphanumeric())
            }) =>
        {
            names.insert(s.clone());
        }
        _ => {}
    }
}
fn assets(db: &Database, s: &Snapshot) -> Result<BTreeMap<String, Vec<u8>>> {
    let mut names = BTreeSet::new();
    asset_names(&json!(s), &mut names);
    names
        .into_iter()
        .map(|name| Ok((name.clone(), fs::read(db.resolve_asset_path(&name)?)?)))
        .collect()
}
fn backup(db: &Database, s: Snapshot) -> Result<Backup> {
    Ok(Backup {
        format: FORMAT.into(),
        version: 1,
        exported_at: now(),
        embedded_assets: assets(db, &s)?
            .into_iter()
            .map(|(n, b)| (n, STANDARD.encode(b)))
            .collect(),
        snapshot: s,
    })
}
pub fn export_backup_gws_json(db: &Database, id: &str) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(&backup(db, db.export_project(id)?)?)?)
}
pub fn export_all_projects_backup(db: &Database) -> Result<Vec<u8>> {
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;
    let projects = crate::repo::query::<Project>(&tx, "ORDER BY id", [])?;
    let entries = projects
        .into_iter()
        .map(|p| backup(db, crate::repo::snapshot(&tx, &p.id)?))
        .collect::<Result<Vec<_>>>()?;
    tx.commit()?;
    Ok(serde_json::to_vec(
        &json!({"format":"gameworkspace-backup-all","version":1,"exportedAt":now(),"projects":entries}),
    )?)
}
fn conflict_ids<R: Record>(
    c: &Connection,
    rows: &[R],
    mut id: impl FnMut(&R) -> &str,
    force: bool,
    ids: &mut HashMap<String, String>,
) -> Result<()> {
    let mut statement = c.prepare(&format!(
        "SELECT EXISTS(SELECT 1 FROM {} WHERE id=?)",
        R::TABLE
    ))?;
    let mut seen = HashSet::new();
    for row in rows {
        let old = id(row);
        if old.is_empty() || !seen.insert(old.to_string()) {
            return Err(Error::Invalid("备份含空 ID 或重复 ID".into()));
        }
        if force || statement.query_row([old], |r| r.get::<_, bool>(0))? {
            ids.entry(old.into())
                .or_insert_with(|| Uuid::new_v4().to_string());
        }
    }
    Ok(())
}
fn restore(c: &Connection, mut s: Snapshot) -> Result<Project> {
    let mut ids = HashMap::new();
    conflict_ids(
        c,
        std::slice::from_ref(&s.project),
        |p| &p.id,
        false,
        &mut ids,
    )?;
    let force = !ids.is_empty();
    macro_rules! groups {($($field:ident),*)=>{$(
        if s.$field.iter().any(|r|r.project_id!=s.project.id){return Err(Error::Invalid("备份包含其他项目的数据".into()))}
        conflict_ids(c,&s.$field,|r|&r.id,force,&mut ids)?;
    )*}}
    groups!(
        entities,
        links,
        maps,
        recipes,
        time_entries,
        activity,
        ai_proposals,
        ai_messages
    );
    for p in &s.ai_proposals {
        if p.status == "pending" && matches!(p.operation.as_str(), "create_entity" | "create_link")
        {
            if let Some(target) = &p.target_entity_id {
                let table = if p.operation == "create_link" {
                    "entity_links"
                } else {
                    "entities"
                };
                if force
                    || c.query_row(
                        &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?)"),
                        [target],
                        |r| r.get::<_, bool>(0),
                    )?
                {
                    ids.entry(target.clone())
                        .or_insert_with(|| Uuid::new_v4().to_string());
                }
            }
        }
    }
    if !ids.is_empty() {
        let mut v = json!(s);
        remap_references(&mut v, "", &ids);
        s = serde_json::from_value(v)?;
        for e in &mut s.entities {
            if e.entity_type == "concept_art" {
                if let Some(tags) = e.data.get_mut("tags") {
                    remap_references(tags, "entityIds", &ids)
                }
            }
        }
        for p in &mut s.ai_proposals {
            if p.entity_type == "concept_art" {
                for snapshot in [&mut p.before, &mut p.after] {
                    if let Some(tags) = snapshot.pointer_mut("/data/tags") {
                        remap_references(tags, "entityIds", &ids)
                    }
                }
            }
        }
        for msg in &mut s.ai_messages {
            remap_references(&mut msg.proposals, "proposalIds", &ids)
        }
    }
    let running = s.time_entries.iter().filter(|e| e.is_running).count();
    if running > 1
        || (running == 1
            && c.query_row(
                "SELECT EXISTS(SELECT 1 FROM time_entries WHERE is_running)",
                [],
                |r| r.get::<_, bool>(0),
            )?)
    {
        return Err(Error::Invalid(
            "备份含运行中的计时，请先停止工作区当前计时后重试".into(),
        ));
    }
    insert_exact(c, &s.project)?;
    macro_rules! save {($($field:ident),*)=>{$(for row in &s.$field{insert_exact(c,row)?;})*}}
    save!(
        entities,
        links,
        time_entries,
        activity,
        maps,
        recipes,
        ai_proposals,
        ai_messages
    );
    Ok(s.project)
}
fn unpack(v: Value) -> Result<Backup> {
    if let Some(format) = v.get("format") {
        if format != FORMAT || v["version"] != 1 {
            return Err(Error::Invalid("不支持的备份格式或版本".into()));
        }
        Ok(serde_json::from_value(v)?)
    } else {
        Ok(Backup {
            format: "legacy".into(),
            version: 1,
            exported_at: String::new(),
            snapshot: serde_json::from_value(v)?,
            embedded_assets: BTreeMap::new(),
        })
    }
}
pub fn import_backup_json(db: &Database, bytes: &[u8]) -> Result<Vec<Project>> {
    let mut v: Value =
        serde_json::from_slice(bytes.strip_prefix(&[239, 187, 191]).unwrap_or(bytes))?;
    let backups = if v["format"] == "gameworkspace-backup-all" {
        if v["version"] != 1 {
            return Err(Error::Invalid("不支持的备份版本".into()));
        }
        v["projects"]
            .as_array_mut()
            .ok_or_else(|| Error::Invalid("缺少项目列表".into()))?
            .drain(..)
            .map(unpack)
            .collect::<Result<Vec<_>>>()?
    } else {
        vec![unpack(v)?]
    };
    db.write(|c| {
        let mut result = Vec::new();
        for b in backups {
            for (name, encoded) in b.embedded_assets {
                let (hash, ext) = name
                    .split_once('.')
                    .ok_or_else(|| Error::Invalid("资源名无效".into()))?;
                let data = STANDARD
                    .decode(encoded)
                    .map_err(|_| Error::Invalid("资源编码无效".into()))?;
                if format!("{:x}", Sha256::digest(&data)) != hash {
                    return Err(Error::Invalid("资源校验失败".into()));
                }
                let info = db.store_asset(&data, ext)?;
                if info.filename != name {
                    return Err(Error::Invalid("资源名称不规范".into()));
                }
            }
            if b.format == FORMAT {
                let mut required = BTreeSet::new();
                asset_names(&json!(b.snapshot), &mut required);
                for name in required {
                    db.resolve_asset_path(&name)
                        .map_err(|_| Error::Invalid(format!("备份缺少资源 {name}")))?;
                }
            }
            result.push(restore(c, b.snapshot)?);
        }
        Ok(result)
    })
}
fn readable(v: &Value, names: &HashMap<&str, &str>) -> String {
    match v {
        Value::String(s) => names.get(s.as_str()).copied().unwrap_or(s).into(),
        Value::Array(a) => a
            .iter()
            .map(|x| readable(x, names))
            .collect::<Vec<_>>()
            .join("；"),
        Value::Object(o) => o
            .iter()
            .filter(|(k, _)| k.as_str() != "id")
            .map(|(k, v)| {
                format!(
                    "{}：{}",
                    names.get(k.as_str()).copied().unwrap_or_else(|| label(k)),
                    readable(v, names)
                )
            })
            .collect::<Vec<_>>()
            .join(" · "),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}
fn label(key: &str) -> &str {
    match key {
        "secretTruth" => "开发者真相",
        "timeline" => "角色时间线",
        "parentId" => "上级",
        "diplomacy" => "外交关系",
        "nodes" => "流程节点",
        "edges" => "流程连线",
        "lines" | "dialogues" => "对白",
        "castIds" => "出场角色",
        "objectives" => "目标",
        "phaseId" => "阶段",
        "dueDate" => "截止日期",
        "members" => "成员",
        "severity" => "严重程度",
        "category" => "类别",
        "role" => "角色定位",
        "rewards" => "奖励",
        "prerequisites" => "前置任务",
        "locationId" => "地点",
        "speakerId" => "说话人",
        "qty" => "数量",
        "itemId" => "物品",
        "ingredients" => "材料",
        "tools" => "工具",
        "entityId" => "关联条目",
        "title" | "label" => "名称",
        "text" => "内容",
        s => s,
    }
}
fn markdown(s: &Snapshot) -> String {
    let p = &s.project;
    let names = s
        .entities
        .iter()
        .map(|e| (e.id.as_str(), e.title.as_str()))
        .collect();
    let mut out = format!(
        "# {} · 游戏设计文档\n\n{}\n\n- 引擎：{}\n- 平台：{}\n- 类型：{}\n",
        p.name,
        p.pitch,
        p.engine,
        p.platforms.join("、"),
        p.genres.join("、")
    );
    for (heading, types) in [
        ("路线图", &["phase", "milestone"][..]),
        ("开发任务", &["task"]),
        ("日历", &["calendar_event"]),
        ("文档", &["doc"]),
        ("设定集", &["lore"]),
        ("概念图", &["concept_art"]),
        ("角色", &["character"]),
        ("地点层级", &["location"]),
        ("阵营与外交", &["faction"]),
        ("载具", &["vehicle"]),
        ("物品", &["item"]),
        ("收集品", &["collectible"]),
        ("任务线", &["quest"]),
        ("场景对白", &["scene"]),
        ("Bug 追踪", &["bug"]),
        ("开发日志", &["devlog"]),
    ] {
        out += &format!("\n## {heading}\n");
        for e in s
            .entities
            .iter()
            .filter(|e| e.deleted_at.is_none() && types.contains(&e.entity_type.as_str()))
        {
            out += &format!("\n### {}\n", e.title);
            for text in [&e.subtitle, &e.summary, &e.body] {
                if !text.is_empty() {
                    out += &format!("\n{text}\n");
                }
            }
            if !e.status.is_empty() {
                out += &format!("\n- 状态：{}\n", e.status)
            }
            if !e.tags.is_empty() {
                out += &format!("- 标签：{}\n", e.tags.join("、"))
            }
            if let Some(fields) = e.data.as_object() {
                for (k, v) in fields {
                    if k == "secretTruth" {
                        out += &format!("\n#### 开发者真相\n\n{}\n\n", readable(v, &names));
                    } else if let Some(entries) =
                        v.as_array().filter(|a| a.iter().any(Value::is_object))
                    {
                        out += &format!("\n**{}**\n\n", label(k));
                        for entry in entries {
                            out += &format!("- {}\n", readable(entry, &names))
                        }
                        out.push('\n');
                    } else {
                        out += &format!("- {}：{}\n", label(k), readable(v, &names));
                    }
                }
            }
        }
    }
    out += "\n## 合成配方\n";
    for r in &s.recipes {
        out += &format!(
            "- {} × {} ← {}。工具：{}。{}\n",
            readable(&json!(r.output_item_id), &names),
            r.output_qty,
            readable(&r.ingredients, &names),
            readable(&r.tools, &names),
            r.note
        );
    }
    out += "\n## 关系网\n";
    for l in &s.links {
        out += &format!(
            "- {} → {}（{}）\n",
            readable(&json!(l.source_id), &names),
            readable(&json!(l.target_id), &names),
            l.relation_label
        );
    }
    out += "\n## 地图设计\n";
    for m in &s.maps {
        out += &format!(
            "\n### {}\n\n{} × {} 格，每格 {} px。\n\n图钉：{}\n",
            m.name,
            m.width,
            m.height,
            m.tile_size,
            readable(&m.pins, &names)
        );
    }
    out += "\n## 工时\n";
    for t in &s.time_entries {
        out += &format!(
            "- {} · {} · {} 秒 {}\n",
            t.started_at,
            readable(&json!(t.task_id), &names),
            t.duration_secs,
            t.note
        );
    }
    out
}
pub fn render_project_markdown(db: &Database, id: &str) -> Result<String> {
    Ok(markdown(&db.export_project(id)?))
}
pub fn export_agent_bundle_zip(db: &Database, id: &str) -> Result<Vec<u8>> {
    let s = db.export_project(id)?;
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let err = |e: zip::result::ZipError| Error::Invalid(e.to_string());
    for dir in ["maps/", "assets/"] {
        zip.add_directory(dir, options).map_err(err)?;
    }
    let mut add = |name: &str, bytes: &[u8]| -> Result<()> {
        zip.start_file(name, options).map_err(err)?;
        zip.write_all(bytes)?;
        Ok(())
    };
    add("README.md",format!("# {} · 开发交付\n\n1. 阅读《设计文档.md》了解玩法、世界设定和开发者真相。\n2. 按 data.json 的实体 ID 还原关系、任务流程、对白与配方，区分回收站记录。\n3. 按 maps/ 中的图层、瓦片大小和图钉坐标重建地图。\n4. 使用 assets/ 内同名资源实现头像、封面与概念图。预设封面对应 assets/<coverPreset>.jpg。\n",s.project.name).as_bytes())?;
    add("设计文档.md", markdown(&s).as_bytes())?;
    add("data.json", &serde_json::to_vec_pretty(&s)?)?;
    let mut used = BTreeSet::new();
    for m in &s.maps {
        let safe = m
            .name
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .take(80)
            .collect::<String>();
        let upper = safe.to_ascii_uppercase();
        let reserved = matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (upper.len() == 4
                && (upper.starts_with("COM") || upper.starts_with("LPT"))
                && upper.as_bytes()[3].is_ascii_digit());
        let safe = if reserved { format!("_{safe}") } else { safe };
        let mut name = format!("maps/{safe}.json");
        let mut n = 2;
        while !used.insert(name.to_lowercase()) {
            name = format!("maps/{safe}-{n}.json");
            n += 1;
        }
        add(&name, &serde_json::to_vec_pretty(m)?)?;
    }
    let mut presets = BTreeSet::new();
    if s.project.cover_asset.is_none() {
        presets.insert(s.project.cover_preset.as_str());
    }
    for entity in &s.entities {
        if let Some(preset) = entity.data["coverPreset"].as_str() {
            presets.insert(preset);
        }
    }
    for name in presets {
        let bytes: &[u8] = match name {
            "lighthouse" => include_bytes!("../../../public/covers/lighthouse.jpg"),
            "castle" => include_bytes!("../../../public/covers/castle.jpg"),
            "city" => include_bytes!("../../../public/covers/city.jpg"),
            "nebula" => include_bytes!("../../../public/covers/nebula.jpg"),
            _ => continue,
        };
        add(&format!("assets/{name}.jpg"), bytes)?;
    }
    for (name, bytes) in assets(db, &s)? {
        add(&format!("assets/{name}"), &bytes)?
    }
    Ok(zip.finish().map_err(err)?.into_inner())
}
