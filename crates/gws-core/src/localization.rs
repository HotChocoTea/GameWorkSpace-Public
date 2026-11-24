use crate::{
    repo::{get, put, query, record_activity},
    Database, Entity, Error, Project, Result,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct LocaleEntry {
    pub key: String,
    #[serde(default)]
    pub source: Option<String>,
    pub translations: BTreeMap<String, String>,
}

pub fn from_entity(e: &Entity) -> Result<LocaleEntry> {
    Ok(LocaleEntry {
        key: e.data["key"].as_str().unwrap_or(&e.title).into(),
        source: Some(e.data["source"].as_str().unwrap_or(&e.body).into()),
        translations: if e.data["translations"].is_null() {
            BTreeMap::new()
        } else {
            serde_json::from_value(e.data["translations"].clone())?
        },
    })
}
pub fn languages(entries: &[LocaleEntry]) -> BTreeSet<String> {
    let mut langs = BTreeSet::from(["en-US".into(), "ja-JP".into()]);
    for entry in entries {
        langs.extend(entry.translations.keys().cloned());
    }
    langs
}
pub fn list_localization(
    db: &Database,
    project: &str,
    locale: Option<&str>,
    missing_only: bool,
) -> Result<Vec<LocaleEntry>> {
    db.get_project(project)?;
    let mut entries = db
        .entity_page(project, Some("locale_entry"), None, None, u32::MAX, 0)?
        .iter()
        .map(from_entity)
        .collect::<Result<Vec<_>>>()?;
    let langs = languages(&entries);
    for e in &mut entries {
        if let Some(locale) = locale {
            e.translations.retain(|l, _| l == locale)
        }
    }
    if missing_only {
        entries.retain(|e| {
            let missing = |l: &str| e.translations.get(l).is_none_or(|s| s.trim().is_empty());
            locale
                .map(missing)
                .unwrap_or_else(|| langs.iter().any(|l| missing(l)))
        })
    }
    entries.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(entries)
}
pub fn upsert_localization(db: &Database, project: &str, entries: &[LocaleEntry]) -> Result<usize> {
    db.write(|c| {
        let _: Project = get(c, project)?;
        let existing = query::<Entity>(
            c,
            "WHERE project_id=? AND entity_type='locale_entry' AND deleted_at IS NULL",
            [project],
        )?;
        let mut by_key = BTreeMap::new();
        for row in existing {
            if by_key.insert(from_entity(&row)?.key, row).is_some() {
                return Err(Error::Invalid("本地化键重复".into()));
            }
        }
        for input in entries {
            if input.key.trim().is_empty()
                || input.translations.keys().any(|s| {
                    s.trim().is_empty() || matches!(s.as_str(), "source_zh" | "key" | "Name")
                })
            {
                return Err(Error::Invalid("本地化键或语言无效".into()));
            }
            let e = by_key.entry(input.key.clone()).or_insert_with(|| Entity {
                id: uuid::Uuid::new_v4().to_string(),
                project_id: project.into(),
                entity_type: "locale_entry".into(),
                title: input.key.clone(),
                data: json!({}),
                ..Default::default()
            });
            let mut merged = from_entity(e)?;
            merged.translations.extend(input.translations.clone());
            if let Some(source) = &input.source {
                merged.source = Some(source.clone())
            }
            if !e.data.is_object() {
                e.data = json!({})
            }
            e.data["key"] = json!(merged.key);
            e.data["translations"] = json!(merged.translations);
            e.data["source"] = json!(merged.source);
            put(c, e)?;
            record_activity(c, e, "update", "更新了本地化")?;
        }
        Ok(entries.len())
    })
}

#[derive(Debug, Serialize, Default)]
pub struct Extraction {
    pub total: usize,
    pub added: usize,
    pub updated: usize,
}

struct Source {
    path: String,
    text: String,
    speaker: String,
}

fn sources(e: &Entity) -> Vec<Source> {
    use crate::impact::rows;
    let mut out = Vec::new();
    let mut add = |path: String, text: &str, speaker: &str| {
        if !text.trim().is_empty() {
            out.push(Source {
                path,
                text: text.into(),
                speaker: speaker.into(),
            });
        }
    };
    if !matches!(
        e.entity_type.as_str(),
        "character" | "location" | "item" | "quest" | "collectible" | "scene"
    ) {
        return out;
    }
    for (field, text) in [
        ("title", &e.title),
        ("subtitle", &e.subtitle),
        ("summary", &e.summary),
        ("body", &e.body),
    ] {
        add(field.into(), text, "");
    }
    if e.entity_type == "scene" {
        for (i, line) in rows(e.data.get("lines").unwrap_or(&e.data["dialogues"]))
            .iter()
            .enumerate()
        {
            let fallback = format!("line-{i}");
            let id = line["id"].as_str().unwrap_or(&fallback);
            let path = format!("line.{id}");
            add(
                path.clone(),
                line["text"].as_str().unwrap_or_default(),
                line["speakerId"].as_str().unwrap_or_default(),
            );
            for (j, choice) in rows(&line["choices"]).iter().enumerate() {
                let fallback = format!("choice-{j}");
                let cid = choice["id"].as_str().unwrap_or(&fallback);
                let text = choice["text"]
                    .as_str()
                    .or(choice["label"].as_str())
                    .or(choice.as_str())
                    .unwrap_or_default();
                add(format!("{path}.choice.{cid}"), text, "");
            }
        }
    }
    for field in match e.entity_type.as_str() {
        "item" => &["effect", "obtainMethod"][..],
        "quest" => &["rewards"],
        "collectible" => &["series", "obtainMethod"],
        _ => &[],
    } {
        add(
            (*field).into(),
            e.data[field].as_str().unwrap_or_default(),
            "",
        );
    }
    if e.entity_type == "quest" {
        for (i, o) in rows(&e.data["objectives"]).iter().enumerate() {
            let fallback = i.to_string();
            let id = o["id"].as_str().unwrap_or(&fallback);
            add(
                format!("objective.{id}"),
                o["text"].as_str().or(o.as_str()).unwrap_or_default(),
                "",
            );
        }
    }
    out
}

pub fn extract_project_localization(db: &Database, project: &str) -> Result<Extraction> {
    db.write(|c| {
        let _: Project = get(c, project)?;
        let entities = query::<Entity>(c, "WHERE project_id=? AND deleted_at IS NULL", [project])?;
        let mut existing = BTreeMap::new();
        // Source references are remapped on project duplication. Keep the original export key.
        let mut origins = BTreeMap::new();
        for e in entities.iter().filter(|e| e.entity_type == "locale_entry") {
            let key = from_entity(e)?.key;
            if let (Some(owner), Some(path)) =
                (e.data["sourceId"].as_str(), e.data["sourcePath"].as_str())
            {
                origins.insert((owner, path), key.clone());
            }
            if existing.insert(key, e.clone()).is_some() {
                return Err(Error::Invalid("本地化键重复".into()));
            }
        }
        let mut result = Extraction {
            total: existing.len(),
            ..Default::default()
        };
        let mut seen = BTreeSet::new();
        for e in &entities {
            for source in sources(e) {
                let key = origins
                    .get(&(e.id.as_str(), source.path.as_str()))
                    .cloned()
                    .unwrap_or_else(|| format!("{}.{}.{}", e.entity_type, e.id, source.path));
                if !seen.insert(key.clone()) {
                    return Err(Error::Invalid(format!("重复文本来源：{key}")));
                }
                let old = existing.remove(&key);
                let created = old.is_none();
                let mut row = old.unwrap_or_else(|| Entity {
                    id: uuid::Uuid::new_v4().to_string(),
                    project_id: project.into(),
                    entity_type: "locale_entry".into(),
                    title: key.clone(),
                    data: json!({"translations":{}}),
                    ..Default::default()
                });
                let before = row.data.clone();
                if !row.data.is_object() {
                    row.data = json!({});
                }
                row.data["key"] = json!(key);
                row.data["source"] = json!(source.text);
                row.data["category"] = json!(e.entity_type);
                row.data["sourceId"] = json!(e.id);
                row.data["sourcePath"] = json!(source.path);
                row.data["speakerId"] = json!(source.speaker);
                if before == row.data {
                    continue;
                }
                put(c, &row)?;
                if created {
                    result.added += 1;
                    result.total += 1;
                } else {
                    result.updated += 1;
                }
            }
        }
        if result.added + result.updated > 0 {
            c.execute(
                "UPDATE projects SET updated_at=?1 WHERE id=?2",
                rusqlite::params![crate::repo::now(), project],
            )?;
        }
        Ok(result)
    })
}

#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationReport {
    pub translated_count: usize,
    pub skipped_count: usize,
    pub errors: Vec<String>,
}

fn validate_locale(locale: &str) -> Result<()> {
    if locale.is_empty()
        || locale.len() > 64
        || !locale
            .split('-')
            .all(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric()))
        || locale.eq_ignore_ascii_case("zh-CN")
        || matches!(locale, "key" | "Name")
    {
        return Err(Error::Invalid("目标语种无效".into()));
    }
    Ok(())
}

pub fn save_locale_translation(
    db: &Database,
    project: &str,
    id: &str,
    locale: &str,
    text: &str,
) -> Result<()> {
    validate_locale(locale)?;
    db.edit_entity(id, |e| {
        if e.project_id != project || e.entity_type != "locale_entry" {
            return Err(Error::Missing);
        }
        let mut translations = from_entity(e)?.translations;
        translations.insert(locale.into(), text.into());
        e.data["translations"] = json!(translations);
        Ok(())
    })?;
    Ok(())
}

pub async fn ai_translate_localization(
    db: &Database,
    project: &str,
    ids: &[String],
    locale: &str,
    provider_id: &str,
    model: &str,
    tier: crate::ai::ReasoningTier,
) -> Result<TranslationReport> {
    use crate::ai::{self, ResponseFormat};
    validate_locale(locale)?;
    let p = db.get_project(project)?;
    let mut config = ai::providers()
        .into_iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| Error::Invalid("未知 AI 服务".into()))?;
    if let Some(setting) = db.get_setting("ai.providers")? {
        let saved = &setting.value["configs"][provider_id];
        if let Some(url) = saved["baseUrl"].as_str() {
            config.base_url = url.into();
        }
        if let Some(key) = saved["requiresKey"].as_bool() {
            config.requires_key = key;
        }
    }
    config.model = model.into();
    config.reasoning_tier = tier;
    let entities = db.entity_page(project, None, None, None, u32::MAX, 0)?;
    let by_id: BTreeMap<_, _> = entities.iter().map(|e| (e.id.as_str(), e)).collect();
    let requested: BTreeSet<_> = ids.iter().map(String::as_str).collect();
    let mut report = TranslationReport::default();
    let mut pending = Vec::new();
    let mut matched = 0;
    for e in entities.iter().filter(|e| {
        e.entity_type == "locale_entry"
            && (requested.is_empty() || requested.contains(e.id.as_str()))
    }) {
        matched += 1;
        let entry = from_entity(e)?;
        let source = entry.source.unwrap_or_default();
        let prior = entry.translations.get(locale).cloned().unwrap_or_default();
        if source.trim().is_empty() || (requested.is_empty() && !prior.trim().is_empty()) {
            report.skipped_count += 1;
            continue;
        }
        let linked = |field: &str| e.data[field].as_str().and_then(|id| by_id.get(id).copied());
        let speaker=linked("speakerId").filter(|s|s.entity_type=="character").map(|s|json!({"title":s.title,"role":s.data["role"],"personality":s.data["personality"],"speechStyle":s.data.get("speechStyle").or(s.data.get("speech"))}));
        let context = linked("sourceId")
            .map(|s| json!({"type":s.entity_type,"title":s.title,"summary":s.summary}));
        let prompt =
            json!({"id":e.id,"key":entry.key,"source":source,"speaker":speaker,"entity":context});
        pending.push((e, source, prior, prompt));
    }
    report.skipped_count += requested.len().saturating_sub(matched);
    let system="你是游戏本地化译者。结合项目设定、角色性格与说话方式，保留文本内的标记和占位符。仅返回 JSON 对象，以输入的 id 作键、译文作字符串值。";
    let mut translated = BTreeMap::new();
    for chunk in pending.chunks(24) {
        let prompt = json!({"targetLocale":locale,"project":{"pitch":p.pitch,"genres":p.genres},"entries":chunk.iter().map(|r|&r.3).collect::<Vec<_>>()});
        let response = db
            .completion(
                &config,
                system,
                vec![json!({"role":"user","content":prompt.to_string()})],
                ResponseFormat::Json,
                |_| {},
            )
            .await;
        let output = match response {
            Ok(s) => s,
            Err(err) => {
                report.errors.push(err.to_string());
                break;
            }
        };
        let parsed = serde_json::from_str::<BTreeMap<String, String>>(ai::json_block(&output));
        match parsed {
            Ok(batch)
                if batch.len() == chunk.len()
                    && chunk
                        .iter()
                        .all(|r| batch.get(&r.0.id).is_some_and(|s| !s.trim().is_empty())) =>
            {
                translated.extend(batch)
            }
            _ => {
                report.errors.push("服务返回的译文缺失或格式无效".into());
                break;
            }
        }
    }
    if !report.errors.is_empty() {
        report.skipped_count += pending.len();
        return Ok(report);
    }
    db.write(|c| {
        for (old,source,prior,_) in pending {
            let current=query::<Entity>(c,"WHERE id=?1 AND project_id=?2 AND entity_type='locale_entry' AND deleted_at IS NULL",[&old.id,project])?.pop();
            let Some(mut row)=current else {report.skipped_count+=1;continue;};
            let mut entry=from_entity(&row)?;
            if entry.source.as_deref()!=Some(&source) || entry.translations.get(locale).map(String::as_str).unwrap_or("")!=prior {
                report.skipped_count+=1;continue;
            }
            entry.translations.insert(locale.into(),translated.remove(&row.id).expect("validated translation"));
            row.data["translations"]=json!(entry.translations);
            put(c,&row)?;
            record_activity(c,&row,"update","翻译了")?;
            report.translated_count+=1;
        }
        Ok(report)
    })
}
