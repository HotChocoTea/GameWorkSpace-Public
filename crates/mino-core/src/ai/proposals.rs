use super::*;
use crate::repo::{record_activity, trash_entity};
use rusqlite::{params, Connection};

fn required<'a>(value: &'a Value, field: &str) -> Result<&'a str> {
    value[field]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| Error::Invalid(format!("缺少字段 {field}")))
}
fn entity(c: &Connection, project: &str, id: &str) -> Result<Entity> {
    let row: Entity = get(c, id)?;
    if row.project_id != project || row.deleted_at.is_some() {
        return Err(Error::Missing);
    }
    Ok(row)
}
fn merge_fields(value: &mut Value, fields: &Value) {
    for key in [
        "title", "subtitle", "summary", "body", "status", "tags", "data",
    ] {
        if let Some(v) = fields.get(key) {
            if key == "data" {
                if let (Some(old), Some(new)) = (value[key].as_object_mut(), v.as_object()) {
                    old.extend(new.clone());
                    continue;
                }
            }
            value[key] = v.clone();
        }
    }
}
fn preview(
    project: &str,
    op: &Value,
    lookup: impl Fn(&str) -> Result<Entity>,
) -> Result<AiProposal> {
    let operation = required(op, "operation")?;
    let (id, kind, title, before, after) = match operation {
        "create_link" => {
            let source = lookup(required(op, "sourceId")?)?;
            let target = lookup(required(op, "targetId")?)?;
            let id = Uuid::new_v4().to_string();
            let link = EntityLink {
                id: id.clone(),
                project_id: project.into(),
                source_id: source.id,
                target_id: target.id,
                relation_label: required(op, "relationLabel")?.into(),
                link_kind: "manual".into(),
                created_at: now(),
            };
            (
                id,
                "link".into(),
                source.title + " → " + &target.title,
                json!({}),
                json!(link),
            )
        }
        "create_entity" | "update_entity" | "delete_entity" => {
            let creating = operation == "create_entity";
            let item = if creating {
                Entity {
                    id: Uuid::new_v4().to_string(),
                    project_id: project.into(),
                    entity_type: required(op, "entityType")?.into(),
                    title: required(op, "title")?.into(),
                    data: json!({}),
                    created_at: now(),
                    updated_at: now(),
                    ..Default::default()
                }
            } else {
                lookup(required(op, "targetEntityId")?)?
            };
            let before = if creating { json!({}) } else { json!(item) };
            let mut after = json!(item);
            if operation == "delete_entity" {
                after = json!({});
            } else {
                merge_fields(&mut after, op.get("patch").unwrap_or(op));
                let changed: Entity = serde_json::from_value(after.clone())?;
                if changed.title.trim().is_empty() {
                    return Err(invalid("标题不能为空"));
                }
            }
            (
                item.id,
                item.entity_type,
                after["title"].as_str().unwrap_or(&item.title).to_string(),
                before,
                after,
            )
        }
        _ => return Err(invalid("未知的 AI 操作")),
    };
    Ok(AiProposal {
        id: Uuid::new_v4().to_string(),
        project_id: project.into(),
        session_id: project.into(),
        target_entity_id: Some(id),
        entity_type: kind,
        operation: operation.into(),
        summary: title,
        before,
        after,
        status: "pending".into(),
        created_at: now(),
    })
}
pub(super) fn stage(c: &Connection, project: &str, op: &Value, auto: bool) -> Result<String> {
    let mut proposal = preview(project, op, |id| entity(c, project, id))?;
    if auto {
        apply(c, &mut proposal, "applied")?;
    } else {
        put(c, &proposal)?;
    }
    Ok(proposal.id)
}
fn same_content(item: &Entity, expected: &Value) -> bool {
    let mut actual = json!(item);
    actual["updatedAt"] = expected["updatedAt"].clone();
    actual == *expected
}
fn apply(c: &Connection, p: &mut AiProposal, status: &str) -> Result<()> {
    if p.status != "pending" {
        return Err(invalid("提议已处理"));
    }
    let id = p.target_entity_id.as_deref().ok_or(Error::Missing)?;
    match p.operation.as_str() {
        "create_link" => {
            let link: EntityLink = serde_json::from_value(p.after.clone())?;
            if link.project_id != p.project_id || link.id != id {
                return Err(Error::Missing);
            }
            let source = entity(c, &p.project_id, &link.source_id)?;
            entity(c, &p.project_id, &link.target_id)?;
            crate::repo::insert_exact(c, &link)?;
            record_activity(c, &source, "link", "关联了")?;
        }
        "create_entity" | "update_entity" | "delete_entity" => {
            if p.operation != "create_entity"
                && !same_content(&entity(c, &p.project_id, id)?, &p.before)
            {
                return Err(invalid("条目在审核期间已修改，请重新生成提议"));
            }
            if p.operation == "delete_entity" {
                trash_entity(c, id)?;
                p.after = json!(get::<Entity>(c, id)?);
            } else {
                let item: Entity = serde_json::from_value(p.after.clone())?;
                if item.project_id != p.project_id || item.id != id || item.deleted_at.is_some() {
                    return Err(Error::Missing);
                }
                if p.operation == "create_entity" {
                    crate::repo::insert_exact(c, &item)?
                } else {
                    put(c, &item)?
                }
                record_activity(c, &item, &p.operation, "AI 写入了")?;
                p.after = json!(get::<Entity>(c, id)?);
            }
        }
        _ => return Err(invalid("未知操作")),
    }
    p.status = status.into();
    put(c, p)
}
impl Database {
    pub fn proposal_batch(
        &self,
        project: &str,
        operations: &[Value],
        mode: &str,
        summary: Option<&str>,
    ) -> Result<Vec<AiProposal>> {
        let work = |c: &Connection| {
            get::<Project>(c, project)?;
            let mut staged = std::collections::HashMap::<String, Option<Entity>>::new();
            let mut results = Vec::new();
            let session = Uuid::new_v4().to_string();
            for op in operations {
                let mut p = preview(project, op, |id| match staged.get(id) {
                    Some(value) => value.clone().ok_or(Error::Missing),
                    None => entity(c, project, id),
                })?;
                p.session_id.clone_from(&session);
                if let Some(s) = summary {
                    p.summary = format!("{s} · {}", p.summary);
                }
                if p.operation != "create_link" {
                    let next = if p.operation == "delete_entity" {
                        None
                    } else {
                        Some(serde_json::from_value(p.after.clone())?)
                    };
                    staged.insert(p.target_entity_id.clone().ok_or(Error::Missing)?, next);
                }
                match mode {
                    "apply" => apply(c, &mut p, "applied")?,
                    "review" => put(c, &p)?,
                    "dry_run" => (),
                    _ => return Err(invalid("未知的批量操作模式")),
                }
                results.push(p);
            }
            Ok(results)
        };
        if mode == "dry_run" {
            let mut conn = self.conn()?;
            let tx = conn.transaction()?;
            let rows = work(&tx)?;
            tx.commit()?;
            Ok(rows)
        } else {
            self.write(work)
        }
    }
    pub fn apply_ai_proposal(&self, id: &str) -> Result<()> {
        self.review_ai_proposals(&[id.to_owned()], true)
    }
    pub fn reject_ai_proposal(&self, id: &str) -> Result<()> {
        self.review_ai_proposals(&[id.to_owned()], false)
    }
    pub fn review_ai_proposals(&self, ids: &[String], accept: bool) -> Result<()> {
        self.write(|c| {
            for id in ids {
                if accept {
                    apply(c, &mut get(c, id)?, "accepted")?;
                } else if c.execute(
                    "UPDATE ai_proposals SET status='rejected' WHERE id=? AND status='pending'",
                    [id],
                )? != 1
                {
                    return Err(invalid("提议已处理"));
                }
            }
            Ok(())
        })
    }
    pub fn rollback_ai_proposal(&self, id: &str) -> Result<()> {
        self.write(|c| {
            let mut p: AiProposal = get(c, id)?;
            if !matches!(p.status.as_str(), "applied" | "accepted") {
                return Err(invalid("提议无法回滚"));
            }
            let target = p.target_entity_id.as_deref().ok_or(Error::Missing)?;
            if p.operation == "create_link" {
                let link: EntityLink = get(c, target)?;
                if link.project_id != p.project_id || json!(link) != p.after {
                    return Err(invalid("关联已更改"));
                }
                c.execute("DELETE FROM entity_links WHERE id=?", [target])?;
                record_activity(c, &get(c, &link.source_id)?, "rollback", "撤销了关联")?;
            } else {
                let current: Entity = get(c, target)?;
                if current.project_id != p.project_id || !same_content(&current, &p.after) {
                    return Err(invalid("条目已更改，无法回滚"));
                }
                if p.operation == "create_entity" {
                    trash_entity(c, target)?;
                } else {
                    let original: Entity = serde_json::from_value(p.before.clone())?;
                    if original.id != target || original.project_id != p.project_id {
                        return Err(Error::Missing);
                    }
                    if p.operation == "delete_entity" {
                        c.execute(
                            "UPDATE entities SET deleted_at=NULL WHERE id=? AND project_id=?",
                            params![target, p.project_id],
                        )?;
                    }
                    put(c, &original)?;
                    c.execute(
                        "UPDATE entities SET updated_at=? WHERE id=?",
                        params![original.updated_at, target],
                    )?;
                    record_activity(c, &original, "rollback", "回滚了")?;
                }
            }
            p.status = "rolled_back".into();
            put(c, &p)
        })
    }
}
