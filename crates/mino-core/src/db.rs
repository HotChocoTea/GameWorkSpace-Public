use rusqlite::{Connection, TransactionBehavior};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Sql(#[from] rusqlite::Error),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Invalid(String),
    #[error("记录不存在或已移至回收站")]
    Missing,
}
pub type Result<T> = std::result::Result<T, Error>;

pub fn resolve_default_data_dir() -> Result<PathBuf> {
    for key in ["GAMEWORKSPACE_DATA_DIR", "MINO_STUDIO_DATA_DIR"] {
        if let Some(path) = std::env::var_os(key).filter(|p| !p.is_empty()) {
            return Ok(std::path::absolute(path)?);
        }
    }
    let root = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("XDG_DATA_HOME").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(|p| PathBuf::from(p).join(".local/share")))
        .ok_or_else(|| {
            Error::Invalid("无法定位用户数据目录，请设置 GAMEWORKSPACE_DATA_DIR".into())
        })?;
    let current = root.join("com.gameworkspace.app");
    let legacy = root.join("studio.mino.desktop");
    Ok(
        if !current.join(crate::DATABASE_NAME).exists()
            && legacy.join(crate::DATABASE_NAME).is_file()
        {
            legacy
        } else {
            current
        },
    )
}

pub struct Database {
    connection: Mutex<Connection>,
    pub(crate) assets: PathBuf,
}

impl Database {
    pub fn data_dir(&self) -> &Path {
        self.assets.parent().expect("assets is a subdirectory")
    }

    /// A TEMP trigger only observes writes made by this connection, including cascades.
    pub fn open_mcp(data_dir: &Path) -> Result<Self> {
        let db = Self::open(data_dir)?;
        db.conn()?.execute_batch(
            "CREATE TEMP TRIGGER tag_mcp AFTER INSERT ON main.change_log
            BEGIN UPDATE change_log SET source='mcp' WHERE seq=NEW.seq; END;",
        )?;
        Ok(db)
    }
    pub fn open(data_dir: &Path) -> Result<Self> {
        let assets = data_dir.join("assets");
        fs::create_dir_all(&assets)?;
        let mut conn = Connection::open(data_dir.join(crate::DATABASE_NAME))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA cache_size=-16000;")?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let version = tx.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))?;
        match version {
            0 => {
                tx.execute_batch(include_str!("schema.sql"))?;
                for table in [
                    "projects",
                    "entities",
                    "entity_links",
                    "time_entries",
                    "activity_log",
                    "maps",
                    "crafting_recipes",
                    "ai_messages",
                    "ai_proposals",
                    "app_settings",
                ] {
                    for (op, row) in [("insert", "NEW"), ("update", "NEW"), ("delete", "OLD")] {
                        let scope = match table {
                            "projects" => format!("{row}.id"),
                            "app_settings" => "NULL".into(),
                            _ => format!("{row}.project_id"),
                        };
                        let key = if table == "app_settings" { "key" } else { "id" };
                        tx.execute_batch(&format!("CREATE TRIGGER log_{table}_{op} AFTER {op} ON {table} BEGIN
                            INSERT INTO change_log(project_id,entity_type,entity_id,action) VALUES({scope},'{table}',{row}.{key},'{op}'); END;"))?;
                    }
                }
            }
            1 | 2 => (),
            version => {
                return Err(Error::Invalid(format!(
                    "数据库版本 {version} 超出当前支持范围"
                )))
            }
        }
        if version < 2 {
            tx.execute_batch("ALTER TABLE projects ADD COLUMN task_columns_json TEXT NOT NULL DEFAULT 'null';
                UPDATE entities SET data_json=json_set(CASE WHEN json_type(data_json)='object' THEN data_json ELSE '{}' END,'$.completedAt',updated_at)
                WHERE entity_type='task' AND status='已完成' AND json_extract(data_json,'$.completedAt') IS NULL;
                UPDATE projects SET enabled_modules_json=json_insert(enabled_modules_json,'$[#]','devlog')
                WHERE EXISTS (SELECT 1 FROM json_each(enabled_modules_json) WHERE value='testing')
                AND NOT EXISTS (SELECT 1 FROM json_each(enabled_modules_json) WHERE value='devlog');")?;
            tx.pragma_update(None, "user_version", 2)?;
        }
        tx.commit()?;
        Ok(Self {
            connection: Mutex::new(conn),
            assets,
        })
    }

    pub(crate) fn conn(&self) -> Result<MutexGuard<'_, Connection>> {
        self.connection
            .lock()
            .map_err(|_| Error::Invalid("数据库连接已中断".into()))
    }

    pub(crate) fn write<T>(&self, work: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let mut conn = self.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let value = work(&tx)?;
        tx.commit()?;
        Ok(value)
    }

    pub fn journal_mode(&self) -> Result<String> {
        Ok(self
            .conn()?
            .pragma_query_value(None, "journal_mode", |r| r.get(0))?)
    }
    pub fn last_change(&self) -> Result<i64> {
        Ok(self
            .conn()?
            .query_row("SELECT coalesce(max(seq),0) FROM change_log", [], |r| {
                r.get(0)
            })?)
    }
}
