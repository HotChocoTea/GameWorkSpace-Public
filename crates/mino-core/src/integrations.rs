use crate::{
    repo::{get, put, query, record_activity},
    *,
};
use rusqlite::{params, Connection, Row};

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
