use crate::{
    repo::{get, put, query, record_activity},
    *,
};
use rusqlite::{params, Connection, Row};

use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Location {
    data_dir: PathBuf,
}

pub fn resolve_location(root: &Path) -> Result<PathBuf> {
    let current = root.join("com.gameworkspace.app");
    match fs::read(current.join("workspace-location.json")) {
        Ok(bytes) => {
            let location: Location = serde_json::from_slice(&bytes)?;
            if !location.data_dir.is_absolute() {
                return Err(Error::Invalid(
                    "工作区指针中的数据目录必须是绝对路径".into(),
                ));
            }
            Ok(location.data_dir)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(current),
        Err(e) => Err(e.into()),
    }
}

pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = tempfile::NamedTempFile::new_in(path.parent().ok_or(Error::Missing)?)?;
    file.write_all(bytes)?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|e| e.error)?;
    Ok(())
}

fn copy_entry(from: &Path, to: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(from)?;
    #[cfg(windows)]
    let linked = std::os::windows::fs::MetadataExt::file_attributes(&metadata) & 0x400 != 0;
    #[cfg(not(windows))]
    let linked = metadata.is_symlink();
    if linked {
        return Err(Error::Invalid("数据目录内含符号链接，请先移除链接".into()));
    }
    if metadata.is_dir() {
        fs::create_dir(to)?;
        for entry in fs::read_dir(from)? {
            let e = entry?;
            copy_entry(&e.path(), &to.join(e.file_name()))?;
        }
    } else if metadata.is_file() {
        fs::copy(from, to)?;
    } else {
        return Err(Error::Invalid("无法迁移特殊文件".into()));
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationStatus {
    pub data_dir: PathBuf,
    pub restart_required: bool,
}

pub fn migrate_data_dir(current_dir: &Path, target_dir: &Path) -> Result<MigrationStatus> {
    migrate_at(current_dir, target_dir, &crate::db::config_root()?)
}

pub fn migrate_at(current_dir: &Path, target_dir: &Path, root: &Path) -> Result<MigrationStatus> {
    let _snapshots = crate::snapshots::SNAPSHOTS
        .lock()
        .map_err(|_| Error::Invalid("快照锁已中断".into()))?;
    let source = current_dir.canonicalize()?;
    if !target_dir.is_absolute() || !source.join(DATABASE_NAME).is_file() {
        return Err(Error::Invalid("请选择有效的绝对路径".into()));
    }
    let ancestor = target_dir
        .ancestors()
        .find(|p| p.exists())
        .ok_or(Error::Missing)?
        .canonicalize()?;
    if ancestor.starts_with(&source) {
        return Err(Error::Invalid("目标必须位于当前数据目录之外".into()));
    }
    fs::create_dir_all(target_dir)?;
    let target = target_dir.canonicalize()?;
    if target.starts_with(&source)
        || source.starts_with(&target)
        || fs::read_dir(&target)?.next().is_some()
    {
        return Err(Error::Invalid("目标必须是独立的空目录".into()));
    }
    let mut conn = Connection::open(source.join(DATABASE_NAME))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    let busy: i64 = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| r.get(0))?;
    if busy != 0 {
        return Err(Error::Invalid("数据库正忙，请稍后重试".into()));
    }
    let writer = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let stage = tempfile::tempdir_in(&target)?;
    let db_path = stage.path().join(DATABASE_NAME);
    // A second reader includes transactions committed between checkpoint and writer lock.
    Connection::open(source.join(DATABASE_NAME))?
        .execute("VACUUM INTO ?1", [db_path.to_str().ok_or(Error::Missing)?])?;
    for name in ["assets", "secrets.bin", "snapshots"] {
        let from = source.join(name);
        if from.try_exists()? {
            copy_entry(&from, &stage.path().join(name))?;
        }
    }
    let integrity: String =
        Connection::open(&db_path)?.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if integrity != "ok" {
        return Err(Error::Invalid(format!("数据库校验失败：{integrity}")));
    }
    let config = root.join("com.gameworkspace.app");
    fs::create_dir_all(&config)?;
    let path = std::path::absolute(target_dir)?;
    let bytes = serde_json::to_vec_pretty(&Location {
        data_dir: path.clone(),
    })?;
    // Existing desktop and agent handles reject subsequent writes to the old generation.
    writer.execute("INSERT INTO app_settings VALUES('workspace:migration_epoch','1',?1) ON CONFLICT(key) DO UPDATE SET value_json=CAST(CAST(value_json AS INTEGER)+1 AS TEXT),updated_at=excluded.updated_at",[crate::repo::now()])?;
    let mut published = Vec::new();
    let publish = (|| -> Result<()> {
        for entry in fs::read_dir(stage.path())? {
            let e = entry?;
            let dest = target.join(e.file_name());
            if dest.try_exists()? {
                return Err(Error::Invalid("目标目录已更改".into()));
            }
            fs::rename(e.path(), &dest)?;
            published.push((dest, e.path()));
        }
        atomic_write(&config.join("workspace-location.json"), &bytes)
    })();
    if let Err(error) = publish {
        for (dest, staged) in published.into_iter().rev() {
            fs::rename(dest, staged)?;
        }
        return Err(error);
    }
    writer.commit()?;
    Ok(MigrationStatus {
        data_dir: path,
        restart_required: true,
    })
}

fn read_change(r: &Row<'_>) -> rusqlite::Result<ChangeLogEntry> {
    Ok(ChangeLogEntry {
        seq: r.get("seq")?,
        project_id: r.get("project_id")?,
        source: r.get("source")?,
        entity_type: r.get("entity_type")?,
        entity_id: r.get("entity_id")?,
        action: r.get("action")?,
        created_at: r.get("created_at")?,
    })
}

fn active(c: &Connection, project: &str, id: &str, kind: Option<&str>) -> Result<Entity> {
    let e: Entity = get(c, id)?;
    if e.project_id != project || e.deleted_at.is_some() || kind.is_some_and(|k| k != e.entity_type)
    {
        return Err(Error::Missing);
    }
    Ok(e)
}

impl Database {
    pub fn list_recent_changes(
        &self,
        source_filter: Option<&str>,
        limit: u32,
    ) -> Result<Vec<ChangeLogEntry>> {
        let c = self.conn()?;
        let mut s = c.prepare(
            "SELECT * FROM change_log WHERE (?1 IS NULL OR source=?1) ORDER BY seq DESC LIMIT ?2",
        )?;
        let rows = s
            .query_map(params![source_filter, limit], read_change)?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }
    pub fn changes_since(&self, seq: i64) -> Result<Vec<ChangeLogEntry>> {
        let c = self.conn()?;
        let mut s = c.prepare_cached("SELECT * FROM change_log WHERE seq>? ORDER BY seq")?;
        let rows = s
            .query_map([seq], read_change)?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }
    pub fn entity_page(
        &self,
        project: &str,
        kind: Option<&str>,
        status: Option<&str>,
        tag: Option<&str>,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<Entity>> {
        query(&*self.conn()?, "WHERE project_id=?1 AND deleted_at IS NULL AND (?2 IS NULL OR entity_type=?2)
            AND (?3 IS NULL OR status=?3) AND (?4 IS NULL OR EXISTS(SELECT 1 FROM json_each(tags_json) WHERE value=?4))
            ORDER BY sort_order,title,id LIMIT ?5 OFFSET ?6", params![project,kind,status,tag,limit,offset])
    }
    /// Keep the read/modify/write under one writer lock, including other processes.
    pub fn edit_entity(
        &self,
        id: &str,
        edit: impl FnOnce(&mut Entity) -> Result<()>,
    ) -> Result<Entity> {
        self.write(|c| {
            let mut row: Entity = get(c, id)?;
            if row.deleted_at.is_some() {
                return Err(Error::Missing);
            }
            edit(&mut row)?;
            put(c, &row)?;
            record_activity(c, &row, "update", "更新了")?;
            get(c, id)
        })
    }
    pub fn edit_map(
        &self,
        id: &str,
        pin_entity: Option<&str>,
        edit: impl FnOnce(&mut MapRecord) -> Result<()>,
    ) -> Result<MapRecord> {
        self.write(|c| {
            let mut row: MapRecord = get(c, id)?;
            if let Some(entity_id) = pin_entity {
                active(c, &row.project_id, entity_id, None)?;
            }
            edit(&mut row)?;
            put(c, &row)?;
            get(c, id)
        })
    }
    pub fn set_manual_link(&self, link: &EntityLink, remove: bool) -> Result<()> {
        self.write(|c| {
            active(c,&link.project_id,&link.source_id,None)?;
            active(c,&link.project_id,&link.target_id,None)?;
            let matches = "project_id=?1 AND source_id=?2 AND target_id=?3 AND relation_label=?4 AND link_kind='manual'";
            let args = params![link.project_id,link.source_id,link.target_id,link.relation_label];
            if remove {
                c.execute(&format!("DELETE FROM entity_links WHERE {matches}"),args)?;
            } else if !c.query_row(&format!("SELECT EXISTS(SELECT 1 FROM entity_links WHERE {matches})"),args,|r|r.get::<_,bool>(0))? {
                put(c,link)?;
            }
            Ok(())
        })
    }
    pub fn set_recipe(&self, recipe: &CraftingRecipe, remove: bool) -> Result<()> {
        self.write(|c| {
            if remove {
                if c.execute(
                    "DELETE FROM crafting_recipes WHERE id=? AND project_id=?",
                    params![recipe.id, recipe.project_id],
                )? == 0
                {
                    return Err(Error::Missing);
                }
            } else {
                active(c, &recipe.project_id, &recipe.output_item_id, Some("item"))?;
                for row in recipe.ingredients.as_array().into_iter().flatten() {
                    active(
                        c,
                        &recipe.project_id,
                        row["itemId"].as_str().ok_or(Error::Missing)?,
                        Some("item"),
                    )?;
                }
                for tool in recipe.tools.as_array().into_iter().flatten() {
                    active(
                        c,
                        &recipe.project_id,
                        tool.as_str().ok_or(Error::Missing)?,
                        Some("item"),
                    )?;
                }
                put(c, recipe)?;
            }
            Ok(())
        })
    }
}
