use crate::{export, Database, Error, Project, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufReader, Write},
    path::Path,
    sync::Mutex,
};

pub const MAX_KEEP: usize = 7;
pub(crate) static SNAPSHOTS: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfo {
    pub filename: String,
    pub created_at: String,
    pub size_bytes: u64,
    pub label: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Header {
    exported_at: String,
    #[serde(default)]
    label: String,
}

fn valid(name: &str) -> bool {
    name.strip_prefix("snapshot-")
        .and_then(|s| s.strip_suffix(".gws.json"))
        .is_some_and(|s| s.len() >= 15 && s.bytes().all(|b| b.is_ascii_digit() || b == b'-'))
}
pub fn list_snapshots(dir: &Path) -> Result<Vec<SnapshotInfo>> {
    let folder = dir.join("snapshots");
    if !folder.try_exists()? {
        return Ok(vec![]);
    }
    let mut result = Vec::new();
    for entry in fs::read_dir(folder)? {
        let entry = entry?;
        let filename = entry.file_name().to_string_lossy().into_owned();
        if !entry.file_type()?.is_file() || !valid(&filename) {
            continue;
        }
        let f = fs::File::open(entry.path())?;
        let size_bytes = f.metadata()?.len();
        let header: Header = serde_json::from_reader(BufReader::new(f))?;
        result.push(SnapshotInfo {
            filename,
            created_at: header.exported_at,
            size_bytes,
            label: header.label,
        });
    }
    result.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| b.filename.cmp(&a.filename))
    });
    Ok(result)
}
fn create(db: &Database, project: Option<&str>, label: &str) -> Result<SnapshotInfo> {
    let bytes = match project {
        Some(id) => export::export_backup_gws_json(db, id)?,
        None => export::export_all_projects_backup(db)?,
    };
    let mut backup: Value = serde_json::from_slice(&bytes)?;
    let time = Utc::now();
    let created_at = time.to_rfc3339_opts(chrono::SecondsFormat::Nanos, true);
    backup["exportedAt"] = json!(created_at);
    backup["label"] = json!(label);
    let folder = db.data_dir().join("snapshots");
    fs::create_dir_all(&folder)?;
    let mut temp = tempfile::NamedTempFile::new_in(&folder)?;
    serde_json::to_writer(temp.as_file_mut(), &backup)?;
    temp.flush()?;
    temp.as_file().sync_all()?;
    let size_bytes = temp.as_file().metadata()?.len();
    let stem = time.format("snapshot-%Y%m%d-%H%M%S").to_string();
    // Never reassign a pruned filename to a different snapshot in the same second.
    let mut serial = 0u64;
    for entry in fs::read_dir(&folder)? {
        let name = entry?.file_name();
        if let Some(suffix) = name
            .to_string_lossy()
            .strip_suffix(".gws.json")
            .and_then(|s| s.strip_prefix(&stem))
        {
            if suffix.is_empty() {
                serial = serial.max(1)
            } else if let Some(n) = suffix.strip_prefix('-').and_then(|s| s.parse::<u32>().ok()) {
                serial = serial.max(u64::from(n) + 1)
            }
        }
    }
    let mut filename = if serial == 0 {
        format!("{stem}.gws.json")
    } else {
        format!("{stem}-{serial:04}.gws.json")
    };
    loop {
        match temp.persist_noclobber(folder.join(&filename)) {
            Ok(_) => break,
            Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => {
                temp = e.file;
                serial += 1;
                filename = format!("{stem}-{serial:04}.gws.json");
            }
            Err(e) => return Err(e.error.into()),
        }
    }
    for old in list_snapshots(db.data_dir())?.into_iter().skip(MAX_KEEP) {
        fs::remove_file(folder.join(old.filename))?;
    }
    Ok(SnapshotInfo {
        filename,
        created_at,
        size_bytes,
        label: label.into(),
    })
}
pub fn create_snapshot(db: &Database, project: Option<&str>, label: &str) -> Result<SnapshotInfo> {
    let _lock = SNAPSHOTS
        .lock()
        .map_err(|_| Error::Invalid("快照锁已中断".into()))?;
    create(db, project, label)
}
pub fn daily_snapshot(db: &Database) -> Result<Option<SnapshotInfo>> {
    let _lock = SNAPSHOTS
        .lock()
        .map_err(|_| Error::Invalid("快照锁已中断".into()))?;
    if db
        .get_setting("snapshots:auto")?
        .is_some_and(|s| s.value == false)
    {
        return Ok(None);
    }
    let latest = list_snapshots(db.data_dir())?.into_iter().next();
    if latest
        .and_then(|s| DateTime::parse_from_rfc3339(&s.created_at).ok())
        .is_some_and(|d| Utc::now().signed_duration_since(d) <= chrono::Duration::days(1))
    {
        return Ok(None);
    }
    Ok(Some(create(db, None, "每日自动快照")?))
}
pub fn restore_snapshot(db: &Database, filename: &str) -> Result<Vec<Project>> {
    if !valid(filename) {
        return Err(Error::Invalid("快照文件名无效".into()));
    }
    let path = db.data_dir().join("snapshots").join(filename);
    if !fs::symlink_metadata(&path)?.is_file() {
        return Err(Error::Invalid("快照文件无效".into()));
    }
    export::import_backup_json(db, &fs::read(path)?)
}
