use super::{slug, unique};
use crate::{impact::rows, Entity, Error, Result};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Write,
};

fn literal(raw: &str) -> String {
    raw.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace(']', "\\]")
        .replace('{', "\\{")
        .replace('}', "\\}")
        .replace('#', "\\#")
        .replace("<<", "\\<\\<")
}
pub(super) fn export(entities: &[Entity]) -> Result<String> {
    let names: BTreeMap<_, _> = entities
        .iter()
        .map(|e| (e.id.as_str(), e.title.as_str()))
        .collect();
    let mut used = BTreeSet::new();
    let mut out = String::new();
    for scene in entities.iter().filter(|e| e.entity_type == "scene") {
        let mut base = slug(&scene.title);
        if !base.starts_with(|c: char| c.is_ascii_alphabetic()) {
            base = format!("Scene_{base}")
        }
        let node = unique(base, &mut used);
        let lines = rows(scene.data.get("lines").unwrap_or(&scene.data["dialogues"]));
        if lines.is_empty() {
            writeln!(out, "title: {node}\n---\n<<stop>>\n===\n").unwrap();
            continue;
        }
        let mut by_id = BTreeMap::new();
        let mut nodes = vec![node.clone()];
        for (i, line) in lines.iter().enumerate() {
            if i > 0 {
                nodes.push(unique(format!("{node}_L{}", i + 1), &mut used))
            }
            if let Some(id) = line["id"].as_str() {
                if by_id.insert(id, nodes[i].clone()).is_some() {
                    return Err(Error::Invalid(format!("重复对白 ID：{id}")));
                }
            }
        }
        let next = |target: &Value, idx: usize| -> Result<String> {
            let dest = match target.as_str().filter(|s| !s.is_empty()) {
                Some("__END__") => None,
                Some(id) => Some(
                    by_id
                        .get(id)
                        .ok_or_else(|| Error::Invalid(format!("对白跳转目标不存在：{id}")))?,
                ),
                None => nodes.get(idx + 1),
            };
            Ok(dest.map_or_else(|| "<<stop>>".into(), |n| format!("<<jump {n}>>")))
        };
        for (i, line) in lines.iter().enumerate() {
            writeln!(out, "title: {}\n---", nodes[i]).unwrap();
            let condition = line["condition"].as_str().unwrap_or("").trim();
            if !condition.is_empty() {
                if condition.contains(['\r', '\n'])
                    || condition.contains(">>")
                    || condition.contains("<<")
                {
                    return Err(Error::Invalid("对白条件必须是单行 Yarn 表达式".into()));
                }
                // Older scenes may contain a native Yarn condition such as a function call.
                let cond = expression(condition, false).or_else(|err| {
                    if condition.contains('$') || condition.contains('(') {
                        Ok(condition.to_owned())
                    } else {
                        Err(err)
                    }
                })?;
                writeln!(out, "<<if {cond}>>").unwrap();
            }
            let speaker = names
                .get(line["speakerId"].as_str().unwrap_or(""))
                .copied()
                .or(line["speakerName"].as_str())
                .unwrap_or("旁白");
            let text = literal(line["text"].as_str().unwrap_or(""));
            if !text.is_empty() {
                writeln!(out, "{}: {text}", literal(speaker)).unwrap();
            }
            for choice in rows(&line["choices"]) {
                let label = choice["text"]
                    .as_str()
                    .or(choice["label"].as_str())
                    .or(choice.as_str())
                    .ok_or_else(|| Error::Invalid("对白选项缺少文字".into()))?;
                write!(out, "-> {}", literal(label)).unwrap();
                if let Some(cond) = choice["condition"]
                    .as_str()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    write!(out, " <<if {}>>", expression(cond, false)?).unwrap();
                }
                out.push('\n');
                if let Some(set) = choice["setVar"]
                    .as_str()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    writeln!(out, "    <<set {}>>", expression(set, true)?).unwrap();
                }
                writeln!(
                    out,
                    "    {}",
                    next(choice.get("nextLineId").unwrap_or(&line["nextLineId"]), i)?
                )
                .unwrap();
            }
            writeln!(out, "{}", next(&line["nextLineId"], i)?).unwrap();
            if !condition.is_empty() {
                writeln!(out, "<<endif>>\n{}", next(&Value::Null, i)?).unwrap();
            }
            out.push_str("===\n\n");
        }
    }
    Ok(out)
}

fn expression(raw: &str, assignment: bool) -> Result<String> {
    let invalid = || Error::Invalid(format!("无效的对白表达式：{raw}"));
    if raw.contains(['\r', '\n']) || raw.contains(">>") || raw.contains("<<") {
        return Err(invalid());
    }
    let variable = |name: &str| -> Result<String> {
        let name = name.trim().trim_start_matches('$');
        if name.is_empty()
            || !name
                .chars()
                .all(|c| c.is_alphanumeric() || matches!(c, '_' | ':' | '：' | '-'))
        {
            return Err(invalid());
        }
        if name.starts_with(|c: char| c.is_ascii_alphabetic())
            && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
            && !name.starts_with("gws_u_")
        {
            Ok(format!("${name}"))
        } else {
            let encoded = name
                .as_bytes()
                .iter()
                .map(|c| format!("{c:02x}"))
                .collect::<String>();
            Ok(format!("$gws_u_{encoded}"))
        }
    };
    let ops: &[&str] = if assignment {
        &["+=", "-=", "="]
    } else {
        &["==", "!=", ">=", "<=", ">", "<"]
    };
    let operator = ops
        .iter()
        .filter_map(|op| raw.find(op).map(|pos| (pos, *op)))
        .min_by_key(|(pos, _)| *pos);
    if let Some((pos, op)) = operator {
        let (left, right) = (&raw[..pos], &raw[pos + op.len()..]);
        let name = variable(left)?;
        let right = right.trim();
        let numeric = right.parse::<f64>().is_ok_and(f64::is_finite);
        if !numeric && matches!(op, "+=" | "-=" | ">=" | "<=" | ">" | "<") {
            return Err(invalid());
        }
        let val = if numeric || matches!(right, "true" | "false") {
            right.into()
        } else if let Ok(s) = serde_json::from_str::<String>(right) {
            serde_json::to_string(&s)?
        } else if !right.is_empty() && !right.starts_with('"') && matches!(op, "=" | "==" | "!=") {
            serde_json::to_string(right)?
        } else {
            return Err(invalid());
        };
        return Ok(match op {
            "+=" => format!("{name} = {name} + {val}"),
            "-=" => format!("{name} = {name} - {val}"),
            _ => format!("{name} {op} {val}"),
        });
    }
    if assignment {
        return Err(invalid());
    }
    if let Some(name) = raw.strip_prefix('!') {
        Ok(format!("not {}", variable(name)?))
    } else {
        variable(raw)
    }
}
