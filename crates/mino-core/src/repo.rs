use crate::{models::*, Database, Error, Result};
use chrono::{SecondsFormat, Utc};
use rusqlite::{
    params, params_from_iter, types::Value as SqlValue, Connection, OptionalExtension, Params, Row,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use uuid::Uuid;

pub fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
pub(crate) trait Column: Sized {
    fn encode(&self) -> SqlValue;
    fn read(row: &Row<'_>, name: &str) -> rusqlite::Result<Self>;
}
macro_rules! scalar {
    ($($t:ty),+) => { $(impl Column for $t {
        fn encode(&self) -> SqlValue { self.clone().into() }
        fn read(row: &Row<'_>, name: &str) -> rusqlite::Result<Self> { row.get(name) }
    })+ }
}
scalar!(String, Option<String>, i64, bool);

fn json_column<T: DeserializeOwned>(row: &Row<'_>, name: &str) -> rusqlite::Result<T> {
    let s: String = row.get(name)?;
    serde_json::from_str(&s).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(
            row.as_ref().column_index(name).unwrap_or(0),
            rusqlite::types::Type::Text,
            Box::new(e),
        )
    })
}
impl Column for Vec<String> {
    fn encode(&self) -> SqlValue {
        Value::from(self.clone()).to_string().into()
    }
    fn read(row: &Row<'_>, name: &str) -> rusqlite::Result<Self> {
        json_column(row, name)
    }
}
impl Column for Value {
    fn encode(&self) -> SqlValue {
        self.to_string().into()
    }
    fn read(row: &Row<'_>, name: &str) -> rusqlite::Result<Self> {
        json_column(row, name)
    }
}

pub trait Record: Sized {
    const TABLE: &'static str;
    const COLUMNS: &'static [&'static str];
    fn values(&self) -> Vec<SqlValue>;
    fn read(row: &Row<'_>) -> rusqlite::Result<Self>;
}

pub(crate) fn insert_exact<R: Record>(c: &Connection, item: &R) -> Result<()> {
    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        R::TABLE,
        R::COLUMNS.join(","),
        vec!["?"; R::COLUMNS.len()].join(",")
    );
    c.execute(&sql, params_from_iter(item.values()))?;
    Ok(())
}
pub(crate) fn put<R: Record>(c: &Connection, item: &R) -> Result<()> {
    let mut values = item.values();
    let stamp = now();
    for (i, col) in R::COLUMNS.iter().enumerate() {
        if *col == "updated_at"
            || (*col == "created_at" && values[i] == SqlValue::Text(String::new()))
        {
            values[i] = stamp.clone().into();
        }
    }
    let assignments = R::COLUMNS
        .iter()
        .filter(|c| !matches!(**c, "id" | "project_id" | "created_at" | "deleted_at"))
        .map(|c| format!("{c}=excluded.{c}"))
        .collect::<Vec<_>>()
        .join(",");
    let scope = if R::TABLE == "entities" {
        " WHERE project_id=excluded.project_id AND deleted_at IS NULL"
    } else if R::COLUMNS.contains(&"project_id") {
        " WHERE project_id=excluded.project_id"
    } else {
        ""
    };
    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({}) ON CONFLICT(id) DO UPDATE SET {assignments}{scope}",
        R::TABLE,
        R::COLUMNS.join(","),
        vec!["?"; values.len()].join(",")
    );
    if c.execute(&sql, params_from_iter(values))? == 0 {
        return Err(Error::Missing);
    }
    Ok(())
}
pub(crate) fn query<R: Record>(
    c: &Connection,
    condition: &str,
    args: impl Params,
) -> Result<Vec<R>> {
    let sql = format!("SELECT * FROM {} {condition}", R::TABLE);
    let mut stmt = c.prepare(&sql)?;
    let rows = stmt
        .query_map(args, R::read)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}
fn scoped<R: Record>(c: &Connection, project: &str) -> Result<Vec<R>> {
    query(c, "WHERE project_id=?1 ORDER BY created_at,id", [project])
}
pub(crate) fn get<R: Record>(c: &Connection, id: &str) -> Result<R> {
    c.query_row(
        &format!("SELECT * FROM {} WHERE id=?1", R::TABLE),
        [id],
        R::read,
    )
    .optional()?
    .ok_or(Error::Missing)
}

pub(crate) fn snapshot(c: &Connection, id: &str) -> Result<Snapshot> {
    Ok(Snapshot {
        project: get(c, id)?,
        entities: scoped(c, id)?,
        links: scoped(c, id)?,
        time_entries: scoped(c, id)?,
        activity: scoped(c, id)?,
        maps: scoped(c, id)?,
        recipes: scoped(c, id)?,
        ai_messages: scoped(c, id)?,
        ai_proposals: scoped(c, id)?,
    })
}
pub(crate) fn save_snapshot(c: &Connection, s: &Snapshot) -> Result<()> {
    put(c, &s.project)?;
    macro_rules! save { ($($group:ident),+) => { $(for item in &s.$group { put(c,item)?; })+ } }
    save!(
        entities,
        links,
        time_entries,
        activity,
        maps,
        recipes,
        ai_messages,
        ai_proposals
    );
    Ok(())
}

pub(crate) fn map_strings(value: &mut Value, replace: &impl Fn(&str) -> Option<String>) {
    match value {
        Value::String(s) => {
            if let Some(v) = replace(s) {
                *s = v
            }
        }
        Value::Array(a) => {
            for x in a {
                map_strings(x, replace)
            }
        }
        Value::Object(o) => {
            for x in o.values_mut() {
                map_strings(x, replace)
            }
        }
        _ => (),
    }
}
macro_rules! domain {
    ($save:ident,$get:ident,$list:ident,$del:ident,$ty:ty) => {
        pub fn $save(&self, item: &$ty) -> Result<()> {
            self.write(|c| put(c, item))
        }
        domain!($get, $list, $del, $ty);
    };
    ($get:ident,$list:ident,$del:ident,$ty:ty) => {
        pub fn $get(&self, id: &str) -> Result<$ty> {
            get(&*self.conn()?, id)
        }
        pub fn $list(&self, project_id: &str) -> Result<Vec<$ty>> {
            scoped(&*self.conn()?, project_id)
        }
        pub fn $del(&self, id: &str) -> Result<()> {
            self.remove(<$ty>::TABLE, id)
        }
    };
}

pub(crate) fn remap_references(value: &mut Value, field: &str, ids: &HashMap<String, String>) {
    match value {
        Value::Object(map) if field == "diplomacy" => {
            for (target_id, tier) in std::mem::take(map) {
                let target = ids.get(&target_id).cloned().unwrap_or(target_id);
                map.insert(target, tier);
            }
        }
        Value::Object(map) => {
            for (key, child) in map {
                remap_references(child, key, ids);
            }
        }
        Value::Array(rows) => {
            for child in rows {
                remap_references(child, field, ids);
            }
        }
        Value::String(id)
            if field == "id"
                || field.ends_with("Id")
                || field.ends_with("Ids")
                || matches!(field, "members" | "tools" | "from" | "to" | "prerequisites") =>
        {
            if let Some(new_id) = ids.get(id) {
                id.clone_from(new_id);
            }
        }
        _ => {}
    }
}

pub(crate) fn trash_entity(c: &Connection, id: &str) -> Result<()> {
    let changed = c.execute(
        "UPDATE entities SET deleted_at=?2,updated_at=?2 WHERE id=?1 AND deleted_at IS NULL",
        params![id, now()],
    )?;
    if changed == 0 {
        return Err(Error::Missing);
    }
    record_activity(c, &get(c, id)?, "delete", "移至回收站")
}

fn restore_entity(c: &Connection, id: &str) -> Result<()> {
    let changed = c.execute(
        "UPDATE entities SET deleted_at=NULL,updated_at=?2 WHERE id=?1
        AND julianday(deleted_at)>julianday('now','-14 days')",
        params![id, now()],
    )?;
    if changed == 0 {
        return Err(Error::Missing);
    }
    record_activity(c, &get(c, id)?, "restore", "恢复了")
}

pub(crate) fn record_activity(
    c: &Connection,
    item: &Entity,
    action: &str,
    verb: &str,
) -> Result<()> {
    let timestamp = now();
    put(
        c,
        &ActivityLog {
            id: Uuid::new_v4().to_string(),
            project_id: item.project_id.clone(),
            entity_id: Some(item.id.clone()),
            entity_type: item.entity_type.clone(),
            action: action.into(),
            summary: format!("{verb}「{}」", item.title),
            created_at: timestamp.clone(),
        },
    )?;
    c.execute(
        "UPDATE projects SET updated_at=?1 WHERE id=?2",
        params![timestamp, item.project_id],
    )?;
    Ok(())
}

impl Database {
    fn remove(&self, table: &str, id: &str) -> Result<()> {
        if self
            .conn()?
            .execute(&format!("DELETE FROM {table} WHERE id=?1"), [id])?
            == 0
        {
            return Err(Error::Missing);
        }
        Ok(())
    }
    pub fn list_projects(&self) -> Result<Vec<Project>> {
        query(&*self.conn()?, "ORDER BY updated_at DESC,id", [])
    }
    pub fn get_project(&self, id: &str) -> Result<Project> {
        get(&*self.conn()?, id)
    }
    pub fn save_project(&self, p: &Project) -> Result<()> {
        self.write(|c| put(c, p))
    }
    pub fn delete_project(&self, id: &str) -> Result<()> {
        self.remove("projects", id)
    }
    pub fn export_project(&self, id: &str) -> Result<Snapshot> {
        let mut c = self.conn()?;
        let tx = c.transaction()?;
        let result = snapshot(&tx, id)?;
        tx.commit()?;
        Ok(result)
    }
    pub fn duplicate_project(&self, id: &str) -> Result<Project> {
        self.write(|c| {
            let original = snapshot(c, id)?;
            let mut data = serde_json::to_value(&original)?;
            let mut ids = HashMap::new();
            ids.insert(id.to_owned(), Uuid::new_v4().to_string());
            if let Some(object) = data.as_object() {
                for list in object.values().filter_map(Value::as_array) {
                    for record in list {
                        if let Some(old) = record["id"].as_str() {
                            ids.insert(old.to_owned(), Uuid::new_v4().to_string());
                        }
                    }
                }
            }
            remap_references(&mut data, "", &ids);
            let mut copy: Snapshot = serde_json::from_value(data)?;
            for art in copy
                .entities
                .iter_mut()
                .filter(|e| e.entity_type == "concept_art")
            {
                if let Some(tags) = art.data.get_mut("tags") {
                    remap_references(tags, "entityIds", &ids);
                }
            }
            copy.project.name = format!("{}（副本）", original.project.name);
            copy.project.created_at = now();
            for entry in copy
                .time_entries
                .iter_mut()
                .filter(|entry| entry.is_running)
            {
                let end = Utc::now();
                entry.duration_secs = chrono::DateTime::parse_from_rfc3339(&entry.started_at)
                    .map(|start| (end - start.with_timezone(&Utc)).num_seconds().max(0))
                    .unwrap_or(0);
                entry.ended_at = Some(end.to_rfc3339());
                entry.is_running = false;
            }
            save_snapshot(c, &copy)?;
            get(c, &copy.project.id)
        })
    }
    pub fn save_entity(&self, e: &Entity) -> Result<()> {
        self.save_entity_batch(std::slice::from_ref(e), &[])
    }

    pub fn save_entity_batch(&self, entities: &[Entity], links: &[EntityLink]) -> Result<()> {
        self.apply_entity_edits(entities, links, &[], &[])
    }
    pub fn apply_entity_edits(
        &self,
        entities: &[Entity],
        links: &[EntityLink],
        restore: &[String],
        trash: &[String],
    ) -> Result<()> {
        self.write(|c| {
            for id in restore {
                restore_entity(c, id)?;
            }
            for item in entities {
                let previous: Option<String> = c
                    .query_row("SELECT status FROM entities WHERE id=?1", [&item.id], |r| {
                        r.get(0)
                    })
                    .optional()?;
                put(c, item)?;
                let (action, verb) = if item.entity_type == "task"
                    && item.status == "已完成"
                    && previous.as_deref() != Some("已完成")
                {
                    ("complete", "完成了")
                } else if previous.is_some() {
                    ("update", "更新了")
                } else {
                    ("create", "创建了")
                };
                record_activity(c, item, action, verb)?;
            }
            for link in links {
                put(c, link)?;
            }
            for id in trash {
                trash_entity(c, id)?;
            }
            Ok(())
        })
    }
    pub fn get_entity(&self, id: &str) -> Result<Entity> {
        get(&*self.conn()?, id)
    }
    pub fn list_entities(&self, project_id: &str) -> Result<Vec<Entity>> {
        query(
            &*self.conn()?,
            "WHERE project_id=?1 AND deleted_at IS NULL ORDER BY sort_order,title",
            [project_id],
        )
    }
    pub fn soft_delete(&self, id: &str) -> Result<()> {
        self.write(|c| trash_entity(c, id))
    }
    pub fn restore(&self, id: &str) -> Result<()> {
        self.write(|c| restore_entity(c, id))
    }
    pub fn purge_expired(&self) -> Result<usize> {
        Ok(self.conn()?.execute(
            "DELETE FROM entities WHERE julianday(deleted_at)<=julianday('now','-14 days')",
            [],
        )?)
    }
    pub fn recycle_bin(&self, project_id: Option<&str>) -> Result<Vec<Entity>> {
        self.purge_expired()?;
        query(&*self.conn()?,"WHERE deleted_at IS NOT NULL AND (?1 IS NULL OR project_id=?1) ORDER BY deleted_at DESC",[project_id])
    }

    domain!(save_link, get_link, list_links, delete_link, EntityLink);
    pub fn save_time_entry(&self, item: &TimeEntry) -> Result<()> {
        self.write(|c| {
            if item.is_running
                && c.query_row(
                    "SELECT EXISTS(SELECT 1 FROM time_entries WHERE is_running AND id<>?1)",
                    [&item.id],
                    |r| r.get::<_, bool>(0),
                )?
            {
                return Err(Error::Invalid("请先停止当前计时".into()));
            }
            put(c, item)
        })
    }
    domain!(
        get_time_entry,
        list_time_entries,
        delete_time_entry,
        TimeEntry
    );
    domain!(
        save_activity,
        get_activity,
        list_activity,
        delete_activity,
        ActivityLog
    );
    domain!(save_map, get_map, list_maps, delete_map, MapRecord);
    domain!(
        save_recipe,
        get_recipe,
        list_recipes,
        delete_recipe,
        CraftingRecipe
    );

    pub fn backlinks(&self, project_id: &str, target: &str) -> Result<Vec<EntityLink>> {
        query(
            &*self.conn()?,
            "WHERE project_id=?1 AND target_id=?2",
            params![project_id, target],
        )
    }
    pub fn search_entities(
        &self,
        project_id: &str,
        query: &str,
        limit: u32,
    ) -> Result<Vec<SearchResult>> {
        self.search_entities_filtered(project_id, query, None, limit)
    }
    pub fn search_entities_filtered(
        &self,
        project_id: &str,
        query: &str,
        entity_type: Option<&str>,
        limit: u32,
    ) -> Result<Vec<SearchResult>> {
        let term = query.trim();
        if term.is_empty() || limit == 0 {
            return Ok(vec![]);
        }
        let conn = self.conn()?;
        let (matches, needle) = if term.chars().count() < 3 {
            ("SELECT e.id,e.entity_type,e.title,e.summary FROM short_terms s JOIN entities e ON e.id=s.entity_id
              WHERE s.project_id=?1 AND s.term=lower(?2) AND (e.title || char(10) || e.subtitle || char(10) || e.summary || char(10) || e.body || char(10) || e.tags_json) LIKE ?3 ESCAPE '\\'
              AND e.title<>?5 COLLATE NOCASE AND (?6 IS NULL OR e.entity_type=?6)",term.to_owned())
        } else {
            ("SELECT entity_id,entity_type,title,summary FROM entities_fts WHERE project_id=?1 AND entities_fts MATCH ?2 AND title<>?5 COLLATE NOCASE AND (?6 IS NULL OR entity_type=?6)",
             format!("\"{}\"",term.replace('"',"\"\"")))
        };
        let pattern = format!(
            "%{}%",
            term.replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        );
        // Return exact titles first. Both index scans can stop once the palette is full.
        let sql = format!(
            "SELECT id,entity_type,title,summary FROM entities WHERE project_id=?1
            AND deleted_at IS NULL AND title=?5 COLLATE NOCASE AND (?6 IS NULL OR entity_type=?6) UNION ALL {matches} LIMIT ?4"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(
                params![
                    project_id,
                    needle,
                    pattern,
                    limit.min(200),
                    term,
                    entity_type
                ],
                |r| {
                    Ok(SearchResult {
                        id: r.get(0)?,
                        entity_type: r.get(1)?,
                        title: r.get(2)?,
                        summary: r.get(3)?,
                    })
                },
            )?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }
    pub fn save_setting<T: Serialize>(&self, key: &str, value: &T) -> Result<()> {
        let value = serde_json::to_string(value)?;
        self.conn()?.execute("INSERT INTO app_settings VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",params![key,value,now()])?;
        Ok(())
    }
    pub fn get_setting(&self, key: &str) -> Result<Option<AppSettings>> {
        Ok(self
            .conn()?
            .query_row("SELECT * FROM app_settings WHERE key=?1", [key], |r| {
                Ok(AppSettings {
                    key: r.get("key")?,
                    value: json_column(r, "value_json")?,
                    updated_at: r.get("updated_at")?,
                })
            })
            .optional()?)
    }
    pub fn delete_setting(&self, key: &str) -> Result<()> {
        self.conn()?
            .execute("DELETE FROM app_settings WHERE key=?1", [key])?;
        Ok(())
    }
    pub fn workspace_stats(&self) -> Result<Vec<ProjectStats>> {
        let c = self.conn()?;
        let mut stmt=c.prepare("WITH totals AS (SELECT project_id,count(*) AS entities,sum(entity_type='task') AS tasks,sum(entity_type='task' AND status='已完成') AS completed FROM entities WHERE deleted_at IS NULL GROUP BY project_id),
        upcoming AS (SELECT project_id,title,json_extract(data_json,'$.dueDate') AS due,row_number() OVER(PARTITION BY project_id ORDER BY json_extract(data_json,'$.dueDate'),id) AS n FROM entities WHERE deleted_at IS NULL AND entity_type='milestone' AND status!='已完成' AND json_extract(data_json,'$.dueDate') IS NOT NULL)
        SELECT p.id,coalesce(t.tasks,0),coalesce(t.completed,0),coalesce(t.entities,0),coalesce((SELECT sum(duration_secs) FROM time_entries WHERE project_id=p.id),0),u.title,u.due FROM projects p LEFT JOIN totals t ON t.project_id=p.id LEFT JOIN upcoming u ON u.project_id=p.id AND u.n=1")?;
        let rows = stmt
            .query_map([], |r| {
                Ok(ProjectStats {
                    project_id: r.get(0)?,
                    tasks: r.get(1)?,
                    completed: r.get(2)?,
                    entities: r.get(3)?,
                    seconds: r.get(4)?,
                    milestone: r.get(5)?,
                    due_date: r.get(6)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }
}
