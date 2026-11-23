use mino_core::{Database, Entity, Result};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub fn relationships(db: &Database, project: &str) -> Result<Value> {
    let nodes = db.list_entities(project)?;
    let ids: HashSet<_> = nodes.iter().map(|e| e.id.as_str()).collect();
    let links: Vec<_> = db
        .list_links(project)?
        .into_iter()
        .filter(|l| ids.contains(l.source_id.as_str()) && ids.contains(l.target_id.as_str()))
        .collect();
    let pair = |a: &str, b: &str| {
        if a < b {
            (a.to_owned(), b.to_owned())
        } else {
            (b.to_owned(), a.to_owned())
        }
    };
    let mut seen: HashSet<_> = links
        .iter()
        .map(|l| pair(&l.source_id, &l.target_id))
        .collect();
    let mut derived = Vec::new();
    for e in &nodes {
        let mut add = |target: &Value, label: &str| {
            if let Some(to) = target
                .as_str()
                .filter(|to| *to != e.id && ids.contains(*to))
            {
                if seen.insert(pair(&e.id, to)) {
                    derived.push(json!({"sourceId":e.id,"targetId":to,"relationLabel":label,"linkKind":"field"}));
                }
            }
        };
        for (key, label) in [
            ("homeId", "家乡"),
            ("factionId", "所属阵营"),
            ("parentId", "上级"),
            ("hqLocationId", "总部"),
            ("ownerCharacterId", "所有人"),
            ("ownerFactionId", "所属阵营"),
            ("partItemIds", "部件"),
            ("giverId", "委托人"),
            ("locationId", "地点"),
            ("questId", "任务线"),
            ("castIds", "出场"),
            ("revealQuestId", "揭示任务"),
            ("prerequisites", "前置"),
            ("characterId", "成员"),
            ("targetId", "关系"),
            ("phaseId", "阶段"),
            ("milestoneId", "里程碑"),
        ] {
            if let Some(a) = e.data[key].as_array() {
                for v in a {
                    add(v, label);
                }
            } else {
                add(&e.data[key], label);
            }
        }
        for m in e.data["members"].as_array().into_iter().flatten() {
            add(m.get("characterId").unwrap_or(m), "成员");
        }
        for (id, v) in e.data["diplomacy"].as_object().into_iter().flatten() {
            add(&json!(id), v.as_str().unwrap_or("外交"));
        }
        for r in e.data["relations"].as_array().into_iter().flatten() {
            add(&r["targetId"], "外交");
        }
    }
    Ok(json!({"nodes":nodes,"manualLinks":links,"fieldLinks":derived}))
}

fn reachable<'a>(
    mut stack: Vec<&'a str>,
    adj: &HashMap<&'a str, Vec<&'a str>>,
) -> HashSet<&'a str> {
    let mut seen = HashSet::new();
    while let Some(id) = stack.pop() {
        if seen.insert(id) {
            stack.extend(adj.get(id).into_iter().flatten().copied());
        }
    }
    seen
}

pub fn flow(quest: &Entity) -> Value {
    let nodes = quest.data["nodes"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let edges = quest.data["edges"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let mut ids = HashSet::new();
    let mut ends = Vec::new();
    let mut warnings = Vec::new();
    for n in nodes {
        match n["id"].as_str() {
            Some(id) if ids.insert(id) => {
                if matches!(
                    n["type"].as_str(),
                    Some("end" | "failure" | "结局" | "失败")
                ) {
                    ends.push(id);
                }
            }
            _ => warnings.push("节点 ID 缺失或重复".to_owned()),
        }
    }
    let mut outgoing = HashMap::<_, Vec<_>>::new();
    let mut incoming = HashMap::<_, Vec<_>>::new();
    let terminals: HashSet<_> = ends.iter().copied().collect();
    for e in edges {
        match (e["from"].as_str(), e["to"].as_str()) {
            (Some(a), Some(b)) if ids.contains(a) && ids.contains(b) => {
                if !terminals.contains(a) {
                    outgoing.entry(a).or_default().push(b);
                    incoming.entry(b).or_default().push(a);
                }
            }
            _ => warnings.push("连线引用了缺失节点".to_owned()),
        }
    }
    if ends.is_empty() {
        warnings.push("缺少结局或失败节点".into());
    }
    let start = nodes
        .iter()
        .find(|n| n["type"] == "start")
        .or_else(|| {
            nodes.iter().find(|n| {
                n["id"]
                    .as_str()
                    .is_some_and(|id| !incoming.contains_key(id))
            })
        })
        .or(nodes.first())
        .and_then(|n| n["id"].as_str());
    let reached = reachable(start.into_iter().collect(), &outgoing);
    let productive = reachable(ends, &incoming);
    for n in nodes {
        if let Some(id) = n["id"].as_str() {
            if !reached.contains(id) {
                warnings.push(format!("起点无法到达 {id}"));
            }
            if !productive.contains(id) {
                warnings.push(format!("{id} 无法到达结局"));
            }
        }
    }
    json!({"questId":quest.id,"nodes":nodes,"edges":edges,"prerequisites":quest.data["prerequisites"].as_array().cloned().unwrap_or_default(),"valid":warnings.is_empty(),"warnings":warnings})
}
