mod tiled;
mod yarn;
use crate::{integrations::atomic_write, localization, Database, Entity, Error, Result};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

pub fn write_export_file(path: &Path, bytes: &[u8]) -> Result<()> {
    atomic_write(path, bytes)
}

pub fn export_map_tiled(map: &crate::MapRecord, stem: &str) -> Result<(Value, Vec<u8>)> {
    tiled::export(map, stem)
}

pub fn write_map_tiled(map: &crate::MapRecord, path: &Path) -> Result<()> {
    if !path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("tmj"))
    {
        return Err(Error::Invalid("请选择 .tmj 地图文件".into()));
    }
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("map");
    let (tmj, atlas) = export_map_tiled(map, stem)?;
    let json = serde_json::to_vec_pretty(&tmj)?;
    let atlas_path = path.with_file_name(format!("{stem}.bmp"));

    // Keep simultaneous exports from mixing the map and atlas from different drafts.
    static WRITES: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = WRITES
        .lock()
        .map_err(|_| Error::Invalid("地图导出已中断".into()))?;
    let previous = match fs::read(&atlas_path) {
        Ok(bytes) if bytes == atlas => return atomic_write(path, &json),
        Ok(bytes) => Some(bytes),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    atomic_write(&atlas_path, &atlas)?;
    if let Err(e) = atomic_write(path, &json) {
        match previous {
            Some(bytes) => atomic_write(&atlas_path, &bytes)?,
            None => fs::remove_file(&atlas_path)?,
        }
        return Err(e);
    }
    Ok(())
}

#[derive(Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Preset {
    Unity,
    Godot,
    Unreal,
    #[default]
    Generic,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct EngineConfig {
    pub target_dir: PathBuf,
    pub preset: Preset,
    pub auto_sync_on_save: bool,
    pub include_maps: bool,
    pub include_yarn: bool,
    pub include_localization: bool,
}
impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            target_dir: PathBuf::new(),
            preset: Preset::Generic,
            auto_sync_on_save: false,
            include_maps: true,
            include_yarn: true,
            include_localization: true,
        }
    }
}
pub fn config(db: &Database, project: &str) -> Result<EngineConfig> {
    Ok(db
        .get_setting(&format!("engine_sync:{project}"))?
        .map(|s| serde_json::from_value(s.value))
        .transpose()?
        .unwrap_or_default())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineSyncResult {
    pub target_dir: PathBuf,
    pub files_written: Vec<String>,
    pub file_sizes: BTreeMap<String, usize>,
    pub synced_at: String,
    pub total_bytes: usize,
}

fn slug(name: &str) -> String {
    let s = name
        .chars()
        .take(75)
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect::<String>();
    let s = s.trim_matches('_');
    if s.is_empty() {
        return "untitled".into();
    }
    let upper = s.to_ascii_uppercase();
    if matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || upper.starts_with("COM")
        || upper.starts_with("LPT")
    {
        format!("gws_{s}")
    } else {
        s.into()
    }
}
fn unique(base: String, used: &mut BTreeSet<String>) -> String {
    let mut name = base.clone();
    let mut i = 1;
    while !used.insert(name.to_lowercase()) {
        i += 1;
        name = format!("{base}_{i}");
    }
    name
}
fn csv_bytes(records: Vec<Vec<String>>) -> Result<Vec<u8>> {
    let mut w = csv::WriterBuilder::new()
        .terminator(csv::Terminator::CRLF)
        .from_writer(vec![0xef, 0xbb, 0xbf]);
    for row in records {
        w.write_record(row)
            .map_err(|e| Error::Invalid(e.to_string()))?;
    }
    w.into_inner().map_err(|e| e.into_error().into())
}
fn entity_json(e: &Entity) -> Value {
    json!({"id":e.id,"title":e.title,"subtitle":e.subtitle,"summary":e.summary,"body":e.body,"tags":e.tags,"status":e.status,"data":e.data})
}
fn resolve_output(path: &Path, db: &Database) -> Result<PathBuf> {
    if !path.is_absolute() {
        return Err(Error::Invalid("引擎输出目录需要绝对路径".into()));
    }
    fs::create_dir_all(path)?;
    let root = path.canonicalize()?;
    if root.starts_with(db.data_dir().canonicalize()?) {
        return Err(Error::Invalid("请选择工作区数据目录之外的输出目录".into()));
    }
    Ok(root)
}
fn managed_name(s: &str) -> bool {
    const TOP: &[&str] = &[
        "items.json",
        "recipes.json",
        "characters.json",
        "locations.json",
        "quests.json",
        "scenes.json",
        "collectibles.json",
        "assets_manifest.json",
        "balance_tables.json",
        "localization.json",
        "localization.csv",
        "dialogue.yarn",
        "GameWorkSpaceData.cs",
        "game_workspace_data.gd",
        "DT_Items.csv",
        "DT_Quests.csv",
        "DT_Localization.csv",
    ];
    if TOP.contains(&s) {
        return true;
    }
    let Some((dir, file)) = s.split_once('/') else {
        return false;
    };
    let Some((base, ext)) = file.rsplit_once('.') else {
        return false;
    };
    match dir {
        "maps" => {
            !base.is_empty()
                && base.chars().all(|c| c.is_alphanumeric() || c == '_')
                && matches!(ext, "tmj" | "bmp")
        }
        "assets" => {
            base.len() == 64
                && base.bytes().all(|b| b.is_ascii_hexdigit())
                && ext.bytes().all(|b| b.is_ascii_alphanumeric())
        }
        _ => false,
    }
}
pub fn sync_project_to_engine(
    db: &Database,
    project: &str,
    config: &EngineConfig,
) -> Result<EngineSyncResult> {
    // Serialize disk publication with project writers and exports from other MCP processes.
    db.write(|connection| {
        let snapshot = crate::repo::snapshot(connection, project)?;
        let files = engine_files(db, snapshot, config)?;
        let target = resolve_output(&config.target_dir, db)?;
        publish(connection, project, config, &target, files)
    })
}

fn engine_files(
    db: &Database,
    mut s: crate::Snapshot,
    config: &EngineConfig,
) -> Result<BTreeMap<String, Vec<u8>>> {
    s.entities.retain(|e| e.deleted_at.is_none());
    s.entities.sort_by(|a, b| a.id.cmp(&b.id));
    let mut files = BTreeMap::<String, Vec<u8>>::new();
    for (kind, file) in [
        ("item", "items"),
        ("character", "characters"),
        ("location", "locations"),
        ("quest", "quests"),
        ("scene", "scenes"),
        ("collectible", "collectibles"),
        ("asset_item", "assets_manifest"),
        ("balance_sheet", "balance_tables"),
    ] {
        let rows: Vec<_> = s
            .entities
            .iter()
            .filter(|e| e.entity_type == kind)
            .map(entity_json)
            .collect();
        files.insert(format!("{file}.json"), serde_json::to_vec_pretty(&rows)?);
    }
    let items: BTreeSet<_> = s
        .entities
        .iter()
        .filter(|e| e.entity_type == "item")
        .map(|e| &e.id)
        .collect();
    s.recipes.retain(|r| items.contains(&r.output_item_id));
    s.recipes.sort_by(|a, b| a.id.cmp(&b.id));
    let recipes:Vec<_>=s.recipes.iter().map(|r|json!({"id":r.id,"outputItemId":r.output_item_id,"outputQty":r.output_qty,"ingredients":r.ingredients,"tools":r.tools,"note":r.note})).collect();
    files.insert("recipes.json".into(), serde_json::to_vec_pretty(&recipes)?);
    for e in s.entities.iter().filter(|e| e.entity_type == "asset_item") {
        if let Some(name) = e.data["asset"].as_str().filter(|s| !s.is_empty()) {
            files.insert(
                format!("assets/{name}"),
                fs::read(db.resolve_asset_path(name)?)?,
            );
        }
    }
    if config.include_maps {
        let mut used = BTreeSet::new();
        s.maps.sort_by(|a, b| a.id.cmp(&b.id));
        for m in s.maps {
            let name = unique(slug(&m.name), &mut used);
            let (tmj, atlas) = export_map_tiled(&m, &name)?;
            files.insert(format!("maps/{name}.tmj"), serde_json::to_vec_pretty(&tmj)?);
            files.insert(format!("maps/{name}.bmp"), atlas);
        }
    }
    if config.include_yarn {
        files.insert(
            "dialogue.yarn".into(),
            yarn::export(&s.entities)?.into_bytes(),
        );
    }
    if config.include_localization {
        let mut entries = s
            .entities
            .iter()
            .filter(|e| e.entity_type == "locale_entry")
            .map(localization::from_entity)
            .collect::<Result<Vec<_>>>()?;
        entries.sort_by(|a, b| a.key.cmp(&b.key));
        let langs = localization::languages(&entries);
        let mut heading = vec!["key".into(), "source_zh".into()];
        heading.extend(langs.iter().cloned());
        let mut records = vec![heading];
        for e in &entries {
            let mut row = vec![e.key.clone(), e.source.clone().unwrap_or_default()];
            row.extend(
                langs
                    .iter()
                    .map(|l| e.translations.get(l).cloned().unwrap_or_default()),
            );
            records.push(row);
        }
        files.insert(
            "localization.json".into(),
            serde_json::to_vec_pretty(&entries)?,
        );
        files.insert("localization.csv".into(), csv_bytes(records.clone())?);
        if config.preset == Preset::Unreal {
            records[0][0] = "Name".into();
            files.insert("DT_Localization.csv".into(), csv_bytes(records)?);
        }
    }
    match config.preset {
        Preset::Unity => {
            files.insert(
                "GameWorkSpaceData.cs".into(),
                include_bytes!("engine_sync/GameWorkSpaceData.cs").to_vec(),
            );
        }
        Preset::Godot => {
            files.insert(
                "game_workspace_data.gd".into(),
                include_bytes!("engine_sync/game_workspace_data.gd").to_vec(),
            );
        }
        Preset::Unreal => {
            for (kind, name) in [("item", "Items"), ("quest", "Quests")] {
                let mut records = vec![["Name", "Title", "Summary", "Status", "Data"]
                    .map(str::to_owned)
                    .to_vec()];
                for e in s.entities.iter().filter(|e| e.entity_type == kind) {
                    records.push(vec![
                        e.id.clone(),
                        e.title.clone(),
                        e.summary.clone(),
                        e.status.clone(),
                        e.data.to_string(),
                    ]);
                }
                files.insert(format!("DT_{name}.csv"), csv_bytes(records)?);
            }
        }
        Preset::Generic => (),
    }
    Ok(files)
}

fn publish(
    connection: &rusqlite::Connection,
    project: &str,
    config: &EngineConfig,
    target: &Path,
    files: BTreeMap<String, Vec<u8>>,
) -> Result<EngineSyncResult> {
    let key = format!(
        "engine_files:{project}:{:x}",
        Sha256::digest(target.to_string_lossy().as_bytes())
    );
    let prior: Option<String> = connection
        .query_row(
            "SELECT value_json FROM app_settings WHERE key=?",
            [&key],
            |r| r.get(0),
        )
        .optional()?;
    let owned: BTreeMap<String, String> = prior
        .as_deref()
        .map(serde_json::from_str)
        .transpose()?
        .unwrap_or_default();
    let mut hashes = BTreeMap::new();
    for (name, bytes) in &files {
        let dest = target.join(name);
        let parent = dest.parent().ok_or(Error::Missing)?;
        fs::create_dir_all(parent)?;
        if !parent.canonicalize()?.starts_with(target) {
            return Err(Error::Invalid("输出子目录位于目标之外".into()));
        }
        atomic_write(&dest, bytes)?;
        hashes.insert(name, format!("{:x}", Sha256::digest(bytes)));
    }
    // Only prune previous outputs that still contain the bytes we published.
    for (name, digest) in owned {
        if files.contains_key(&name) || !managed_name(&name) {
            continue;
        }
        let path = target.join(name);
        if path.is_file()
            && path.canonicalize()?.starts_with(target)
            && format!("{:x}", Sha256::digest(fs::read(&path)?)) == digest
        {
            fs::remove_file(path)?;
        }
    }
    connection.execute("INSERT INTO app_settings VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at WHERE value_json!=excluded.value_json",rusqlite::params![key,serde_json::to_string(&hashes)?,crate::repo::now()])?;
    let file_sizes: BTreeMap<_, _> = files.iter().map(|(p, b)| (p.clone(), b.len())).collect();
    Ok(EngineSyncResult {
        target_dir: config.target_dir.clone(),
        files_written: file_sizes.keys().cloned().collect(),
        total_bytes: file_sizes.values().sum(),
        file_sizes,
        synced_at: crate::repo::now(),
    })
}
