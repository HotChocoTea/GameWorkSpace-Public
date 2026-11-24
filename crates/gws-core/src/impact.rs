use crate::{
    repo::{put, query},
    Database, Entity, EntityLink, Error, Result,
};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

fn text_mentions(e: &Entity) -> BTreeSet<String> {
    fn scan(text: &str, out: &mut BTreeSet<String>) {
        let mut rest = text;
        while let Some((_, suffix)) = rest.split_once("[[") {
            let Some((title, tail)) = suffix.split_once("]]") else {
                break;
            };
            let name = title.rsplit("[[").next().unwrap_or("").trim();
            if !name.is_empty() && !name.contains(['\n', '\r', '[', ']']) {
                out.insert(name.into());
            }
            rest = tail;
        }
    }
    fn visit(v: &Value, out: &mut BTreeSet<String>) {
        match v {
            Value::String(s) => scan(s, out),
            Value::Array(a) => a.iter().for_each(|x| visit(x, out)),
            Value::Object(o) => o.values().for_each(|x| visit(x, out)),
            _ => (),
        }
    }
    let mut out = BTreeSet::new();
    for s in [&e.title, &e.subtitle, &e.body, &e.summary, &e.status]
        .into_iter()
        .chain(&e.tags)
    {
        scan(s, &mut out)
    }
    visit(&e.data, &mut out);
    out
}

pub(crate) fn sync_mentions(c: &Connection, project: &str) -> Result<()> {
    let entities = query::<Entity>(
        c,
        "WHERE project_id=? AND deleted_at IS NULL ORDER BY sort_order,title,id",
        [project],
    )?;
    let mut titles = BTreeMap::new();
    for row in &entities {
        titles.entry(row.title.trim()).or_insert(&row.id);
    }
    let mut wanted = BTreeSet::new();
    for e in &entities {
        for title in text_mentions(e) {
            if let Some(target) = titles.get(title.as_str()) {
                if *target != &e.id {
                    wanted.insert((e.id.clone(), (*target).clone()));
                }
            }
        }
    }
    let links = query::<EntityLink>(
        c,
        "WHERE project_id=? ORDER BY link_kind='mention',id",
        [project],
    )?;
    for l in links {
        let needed = wanted.remove(&(l.source_id, l.target_id));
        if !needed && l.link_kind == "mention" {
            c.execute("DELETE FROM entity_links WHERE id=?", [l.id])?;
        }
    }
    for (source_id, target_id) in wanted {
        put(
            c,
            &EntityLink {
                id: uuid::Uuid::new_v4().to_string(),
                project_id: project.into(),
                source_id,
                target_id,
                relation_label: "提及".into(),
                link_kind: "mention".into(),
                ..Default::default()
            },
        )?;
    }
    Ok(())
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    pub id: String,
    pub entity_type: String,
    pub title: String,
    pub detail: String,
}
fn reference(e: &Entity, detail: &str) -> Reference {
    Reference {
        id: e.id.clone(),
        entity_type: e.entity_type.clone(),
        title: e.title.clone(),
        detail: detail.into(),
    }
}
#[derive(Default, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImpactReport {
    pub outgoing_links: Vec<Reference>,
    pub incoming_links: Vec<Reference>,
    pub crafting_recipes: Vec<Reference>,
    pub map_pins: Vec<Reference>,
    pub scene_references: Vec<Reference>,
    pub quest_references: Vec<Reference>,
    pub field_references: Vec<Reference>,
    pub mentions_in_text: Vec<Reference>,
    pub total_references: usize,
}

pub fn analyze_entity_impact(db: &Database, project: &str, id: &str) -> Result<ImpactReport> {
    let s = db.export_project(project)?;
    let active: BTreeMap<_, _> = s
        .entities
        .iter()
        .filter(|e| e.deleted_at.is_none())
        .map(|e| (e.id.as_str(), e))
        .collect();
    let target = active.get(id).ok_or(Error::Missing)?;
    let mut report = ImpactReport::default();
    for l in s.links {
        if l.source_id == id {
            if let Some(e) = active.get(l.target_id.as_str()) {
                report.outgoing_links.push(reference(e, &l.relation_label));
            }
        }
        if l.target_id == id {
            if let Some(e) = active.get(l.source_id.as_str()) {
                report.incoming_links.push(reference(e, &l.relation_label));
            }
        }
    }
    for r in s.recipes {
        let Some(output) = active.get(r.output_item_id.as_str()) else {
            continue;
        };
        if r.output_item_id == id
            || rows(&r.ingredients).iter().any(|v| v["itemId"] == id)
            || rows(&r.tools).iter().any(|v| v == id || v["itemId"] == id)
        {
            report
                .crafting_recipes
                .push(reference(output, &format!("合成配方 · {}", r.id)));
        }
    }
    for m in s.maps {
        for pin in rows(&m.pins) {
            if pin["entityId"] == id {
                report.map_pins.push(Reference {
                    id: m.id.clone(),
                    entity_type: "map".into(),
                    title: m.name.clone(),
                    detail: pin["label"].as_str().unwrap_or("图钉").into(),
                });
            }
        }
    }
    for e in active.values() {
        if e.id == id {
            continue;
        }
        let fields: &[&str] = match e.entity_type.as_str() {
            "scene" => &[
                "locationId",
                "questId",
                "castIds",
                "lines.speakerId",
                "dialogues.speakerId",
            ],
            "quest" => &["giverId", "locationId", "prerequisites"],
            "location" => &["parentId"],
            "faction" => &["hqLocationId", "members.characterId"],
            "vehicle" => &["ownerCharacterId", "ownerFactionId", "partItemIds"],
            "collectible" => &["locationId", "questId"],
            "asset_item" => &["linkedEntityIds"],
            _ => &[],
        };
        for &field in fields {
            let group = match e.entity_type.as_str() {
                "scene" => &mut report.scene_references,
                "quest" => &mut report.quest_references,
                _ => &mut report.field_references,
            };
            if let Some((parent, child)) = field.split_once('.') {
                for (i, v) in rows(&e.data[parent]).iter().enumerate() {
                    if v[child] == id {
                        group.push(reference(e, &format!("{field} #{}", i + 1)));
                    }
                }
            } else if e.data[field] == id || rows(&e.data[field]).iter().any(|v| v == id) {
                group.push(reference(e, field));
            }
        }
        if text_mentions(e).contains(target.title.trim()) {
            report
                .mentions_in_text
                .push(reference(e, &format!("[[{}]]", target.title)));
        }
    }
    report.total_references = [
        &report.incoming_links,
        &report.outgoing_links,
        &report.crafting_recipes,
        &report.map_pins,
        &report.scene_references,
        &report.quest_references,
        &report.field_references,
        &report.mentions_in_text,
    ]
    .iter()
    .map(|v| v.len())
    .sum();
    Ok(report)
}
pub(crate) fn rows(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or_default()
}
