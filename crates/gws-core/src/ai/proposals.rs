use super::*;
use crate::repo::{insert_exact, record_activity, trash_entity, Record};
use rusqlite::{params, Connection};
use serde::de::DeserializeOwned;

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
fn scoped<R: Record>(c: &Connection, project: &str, id: &str) -> Result<R> {
    query(c, "WHERE project_id=? AND id=?", [project, id])?
        .pop()
        .ok_or(Error::Missing)
}
fn target_id<'a>(op: &'a Value, keys: &[&str]) -> Result<&'a str> {
    keys.iter()
        .chain([&"targetEntityId"])
        .find_map(|key| op[key].as_str().filter(|s| !s.trim().is_empty()))
        .ok_or_else(|| Error::Invalid(format!("缺少目标 ID {}", keys[0])))
}
fn array(value: &Value) -> Result<&[Value]> {
    if value.is_null() {
        return Ok(&[]);
    }
    value
        .as_array()
        .map(Vec::as_slice)
        .ok_or_else(|| invalid("需要数组"))
}
fn number(value: &Value, key: &str, default: i64) -> Result<i64> {
    value.get(key).map_or(Ok(default), |n| {
        n.as_i64()
            .ok_or_else(|| Error::Invalid(format!("{key} 必须是整数")))
    })
}
fn tile(value: &Value) -> Result<u64> {
    value
        .as_u64()
        .ok_or_else(|| invalid("图块 ID 必须是非负整数"))
}
fn position(v: &Value, width: usize, height: usize) -> Option<(usize, usize)> {
    let x = usize::try_from(v["x"].as_u64()?).ok()?;
    let y = usize::try_from(v["y"].as_u64()?).ok()?;
    (x < width && y < height).then_some((x, y))
}
fn cell(v: &Value, width: usize, height: usize) -> Result<(usize, usize)> {
    position(v, width, height).ok_or_else(|| invalid("坐标超出地图"))
}
fn normalize_map_layers(raw: &Value, width: usize, height: usize) -> Result<Value> {
    let mut layers = Vec::new();
    for (index, l) in array(raw)?.iter().enumerate() {
        if !l.is_object() {
            return Err(invalid("无效的地图图层"));
        }
        let mut tiles = vec![0u64; width * height];
        if let Some(flat) = l.get("tiles") {
            for (dest, value) in tiles.iter_mut().zip(array(flat)?) {
                *dest = tile(value)?;
            }
        } else if let Some(grid) = l.get("grid").or_else(|| l.get("rows")) {
            for (row, values) in tiles.chunks_mut(width).zip(array(grid)?) {
                for (dest, value) in row.iter_mut().zip(array(values)?) {
                    *dest = tile(value)?;
                }
            }
        }
        for edit in array(&l["cells"])? {
            let (x, y) = cell(edit, width, height)?;
            tiles[y * width + x] = tile(&edit["tileId"])?;
        }
        let mut icons = Vec::new();
        for icon in array(&l["icons"])? {
            let (x, y) = cell(icon, width, height)?;
            icons.push(json!({"x":x,"y":y,"iconId":required(icon,"iconId")?}));
        }
        let name = l["name"]
            .as_str()
            .filter(|n| !n.trim().is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| {
                if index == 0 {
                    "底图".into()
                } else {
                    format!("图层 {}", index + 1)
                }
            });
        layers.push(json!({"name":name,"visible":l["visible"].as_bool().unwrap_or(true),"tiles":tiles,"icons":icons}));
    }
    if layers.is_empty() {
        layers
            .push(json!({"name":"底图","visible":true,"tiles":vec![0u64;width*height],"icons":[]}));
    }
    Ok(Value::Array(layers))
}
fn pin(v: &Value, width: usize, height: usize) -> Result<Value> {
    let (x, y) = cell(v, width, height)?;
    let id = v["id"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    Ok(
        json!({"x":x,"y":y,"id":id,"label":v["label"].as_str().unwrap_or("图钉"),"entityId":v["entityId"].as_str().unwrap_or(""),"color":v["color"].as_str().unwrap_or("#ad5946")}),
    )
}
fn edit_layers(map: &mut MapRecord, op: &Value, w: usize, h: usize, resized: bool) -> Result<()> {
    // Resizing the canvas retains the coordinates of existing tiles in the overlapping rectangle.
    if resized && op.get("layers").is_none() {
        let old_width = usize::try_from(map.width).unwrap_or(0);
        for layer in map.layers.as_array_mut().into_iter().flatten() {
            if !layer.is_object() {
                return Err(invalid("无效的地图图层"));
            }
            if old_width > 0 {
                if let Some(tiles) = layer["tiles"].take().as_array() {
                    layer["grid"] = tiles
                        .chunks(old_width)
                        .take(h)
                        .map(|r| json!(&r[..r.len().min(w)]))
                        .collect();
                }
                layer
                    .as_object_mut()
                    .ok_or_else(|| invalid("无效的地图图层"))?
                    .remove("tiles");
            }
            if let Some(icons) = layer["icons"].as_array_mut() {
                icons.retain(|i| position(i, w, h).is_some());
            }
        }
    }
    map.layers = normalize_map_layers(op.get("layers").unwrap_or(&map.layers), w, h)?;
    for edit in array(&op["tileEdits"])? {
        let (x, y) = cell(edit, w, h)?;
        let index = edit["layerIndex"]
            .as_u64()
            .and_then(|i| usize::try_from(i).ok())
            .ok_or_else(|| invalid("无效图层索引"))?;
        let layer = map
            .layers
            .get_mut(index)
            .ok_or_else(|| invalid("图层不存在"))?;
        layer["tiles"][y * w + x] = json!(tile(&edit["tileId"])?);
    }
    Ok(())
}
fn edit_pins(map: &mut MapRecord, op: &Value, w: usize, h: usize, resized: bool) -> Result<()> {
    let mut pins = Vec::new();
    for v in array(op.get("pins").unwrap_or(&map.pins))? {
        if resized && op.get("pins").is_none() && position(v, w, h).is_none() {
            continue;
        }
        pins.push(pin(v, w, h)?);
    }
    for v in array(&op["pinUpserts"])? {
        cell(v, w, h)?;
        let index = pins.iter().position(|p| {
            if let Some(id) = v["id"].as_str() {
                p["id"] == id
            } else {
                p["x"] == v["x"] && p["y"] == v["y"]
            }
        });
        if v["remove"] == true {
            if let Some(i) = index {
                pins.remove(i);
            }
        } else if let Some(i) = index {
            let mut updated = pins[i].clone();
            updated
                .as_object_mut()
                .unwrap()
                .extend(v.as_object().unwrap().clone());
            pins[i] = pin(&updated, w, h)?;
        } else {
            pins.push(pin(v, w, h)?);
        }
    }
    map.pins = json!(pins);
    Ok(())
}
fn custom_tiles(raw: &Value) -> Result<Value> {
    let mut custom = Vec::new();
    for (i, v) in array(raw)?.iter().enumerate() {
        if !v.is_object() {
            return Err(invalid("无效的自定义图块"));
        }
        let id = v.get("id").map(tile).transpose()?.unwrap_or(20 + i as u64);
        custom.push(json!({"id":id,"name":v["name"].as_str().unwrap_or("图块"),"color":v["color"].as_str().unwrap_or("#728e81")}));
    }
    Ok(Value::Array(custom))
}
fn map_changes(map: &mut MapRecord, op: &Value) -> Result<()> {
    if op.get("name").is_some() {
        map.name = required(op, "name")?.into();
    }
    let width = number(op, "width", map.width)?;
    let height = number(op, "height", map.height)?;
    let tile_size = number(op, "tileSize", map.tile_size)?;
    if !(1..=128).contains(&width)
        || !(1..=128).contains(&height)
        || !(8..=128).contains(&tile_size)
    {
        return Err(invalid("地图宽高必须在 1..128，图块尺寸必须在 8..128"));
    }
    let (w, h) = (width as usize, height as usize);
    let resized = width != map.width || height != map.height;
    if resized || op.get("layers").is_some() || op.get("tileEdits").is_some() {
        edit_layers(map, op, w, h, resized)?;
    }
    if resized || op.get("pins").is_some() || op.get("pinUpserts").is_some() {
        edit_pins(map, op, w, h, resized)?;
    }
    if let Some(raw) = op.get("customTiles") {
        map.custom_tiles = custom_tiles(raw)?;
    }
    map.width = width;
    map.height = height;
    map.tile_size = tile_size;
    Ok(())
}
fn new_map(project: &str, fields: &Value) -> Result<MapRecord> {
    let mut map = MapRecord {
        id: Uuid::new_v4().to_string(),
        project_id: project.into(),
        name: required(fields, "name")?.into(),
        tile_size: 32,
        custom_tiles: json!([]),
        created_at: now(),
        updated_at: now(),
        ..Default::default()
    };
    map_changes(&mut map, fields)?;
    Ok(map)
}
fn validate_recipe(c: &Connection, r: &CraftingRecipe) -> Result<Entity> {
    let item = |id: &str| {
        let e = entity(c, &r.project_id, id)?;
        if e.entity_type != "item" {
            return Err(invalid("配方引用必须为当前项目的物品"));
        }
        Ok(e)
    };
    if r.output_qty < 1 {
        return Err(invalid("产物数量必须为正整数"));
    }
    for v in array(&r.ingredients)? {
        item(required(v, "itemId")?)?;
        if v.get("qty")
            .or_else(|| v.get("quantity"))
            .and_then(Value::as_u64)
            .is_none_or(|n| n == 0)
        {
            return Err(invalid("材料数量必须为正整数"));
        }
    }
    for v in array(&r.tools)? {
        item(v.as_str().ok_or_else(|| invalid("配方工具必须是物品 ID"))?)?;
    }
    item(&r.output_item_id)
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
fn preview(c: &Connection, project: &str, op: &Value) -> Result<AiProposal> {
    let lookup = |id: &str| entity(c, project, id);
    let operation = required(op, "operation")?;
    let (id, kind, title, before, after) = match operation {
        "create_map" | "update_map" | "delete_map" => {
            if operation == "create_map" {
                let map = new_map(project, op)?;
                (
                    map.id.clone(),
                    "map".into(),
                    map.name.clone(),
                    json!({}),
                    json!(map),
                )
            } else {
                let mut map: MapRecord =
                    scoped(c, project, target_id(op, &["targetMapId", "mapId"])?)?;
                let before = json!(map);
                let after = if operation == "delete_map" {
                    json!({})
                } else {
                    map_changes(&mut map, op)?;
                    json!(map)
                };
                (map.id, "map".into(), map.name, before, after)
            }
        }
        "upsert_recipe" => {
            let previous = match op["id"].as_str() {
                Some(id) => {
                    query::<CraftingRecipe>(c, "WHERE project_id=? AND id=?", [project, id])?.pop()
                }
                None => None,
            };
            let before = previous.as_ref().map_or(json!({}), |r| json!(r));
            let mut r = previous.unwrap_or_else(|| CraftingRecipe {
                id: Uuid::new_v4().to_string(),
                project_id: project.into(),
                output_qty: 1,
                ingredients: json!([]),
                tools: json!([]),
                created_at: now(),
                updated_at: now(),
                ..Default::default()
            });
            r.output_item_id = required(op, "outputItemId")?.into();
            r.output_qty = number(op, "outputQty", r.output_qty)?;
            if let Some(v) = op.get("ingredients") {
                r.ingredients = json!(array(v)?);
            }
            if let Some(v) = op.get("tools") {
                r.tools = json!(array(v)?);
            }
            if let Some(v) = op.get("note") {
                r.note = v
                    .as_str()
                    .ok_or_else(|| invalid("配方备注必须是文本"))?
                    .into();
            }
            let output = validate_recipe(c, &r)?;
            (
                r.id.clone(),
                "recipe".into(),
                format!("合成：{}", output.title),
                before,
                json!(r),
            )
        }
        "delete_recipe" => {
            let r: CraftingRecipe =
                scoped(c, project, target_id(op, &["targetRecipeId", "recipeId"])?)?;
            (
                r.id.clone(),
                "recipe".into(),
                format!("合成：{}", get::<Entity>(c, &r.output_item_id)?.title),
                json!(r),
                json!({}),
            )
        }
        "delete_link" => {
            let l: EntityLink = scoped(c, project, target_id(op, &["targetLinkId", "linkId"])?)?;
            (
                l.id.clone(),
                "link".into(),
                l.relation_label.clone(),
                json!(l),
                json!({}),
            )
        }
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
            if let Some(kind) = op.get("entityType") {
                modules::validate_entity(kind.as_str().unwrap_or_default())?;
            }
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
            modules::validate_entity(&item.entity_type)?;
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
fn same_content(mut actual: Value, expected: &Value) -> bool {
    if actual.get("updatedAt").is_some() {
        actual["updatedAt"] = expected["updatedAt"].clone();
    }
    actual == *expected
}

// Switch a special-table row between reviewed snapshots. An empty snapshot means the row is absent.
fn transition<R: Record + DeserializeOwned + Serialize>(
    c: &Connection,
    p: &AiProposal,
    rollback: bool,
) -> Result<Value> {
    let id = p.target_entity_id.as_deref().ok_or(Error::Missing)?;
    let (from, to) = if rollback {
        (&p.after, &p.before)
    } else {
        (&p.before, &p.after)
    };
    let absent = json!({});
    if from != &absent && !same_content(json!(scoped::<R>(c, &p.project_id, id)?), from) {
        return Err(invalid("记录已更改，无法应用或回滚提议"));
    }
    if to == &absent {
        let sql = format!("DELETE FROM {} WHERE id=? AND project_id=?", R::TABLE);
        if c.execute(&sql, params![id, p.project_id])? != 1 {
            return Err(Error::Missing);
        }
        return Ok(absent);
    }
    if to["projectId"] != p.project_id || to["id"] != id {
        return Err(Error::Missing);
    }
    let row: R = serde_json::from_value(to.clone())?;
    if from == &absent {
        insert_exact(c, &row)?;
    } else {
        put(c, &row)?;
        if rollback && R::COLUMNS.contains(&"updated_at") {
            let sql = format!(
                "UPDATE {} SET updated_at=? WHERE id=? AND project_id=?",
                R::TABLE
            );
            c.execute(
                &sql,
                params![
                    to["updatedAt"].as_str().ok_or(Error::Missing)?,
                    id,
                    p.project_id
                ],
            )?;
        }
    }
    Ok(json!(get::<R>(c, id)?))
}
fn change_record(c: &Connection, p: &AiProposal, rollback: bool) -> Result<Value> {
    let to = if rollback { &p.before } else { &p.after };
    let (result, description) = match p.operation.as_str() {
        "create_map" | "update_map" | "delete_map" => {
            let verb = match p.operation.as_str() {
                "create_map" => "创建了地图",
                "update_map" => "更新了地图",
                _ => "删除了地图",
            };
            (
                transition::<MapRecord>(c, p, rollback)?,
                format!(
                    "AI {verb} {}",
                    p.after["name"]
                        .as_str()
                        .or(p.before["name"].as_str())
                        .unwrap_or_default()
                ),
            )
        }
        "upsert_recipe" | "delete_recipe" => {
            if to.get("id").is_some() {
                validate_recipe(c, &serde_json::from_value(to.clone())?)?;
            }
            (
                transition::<CraftingRecipe>(c, p, rollback)?,
                format!("AI 修改了配方 {}", p.summary),
            )
        }
        "create_link" | "delete_link" => {
            if to.get("id").is_some() {
                entity(c, &p.project_id, required(to, "sourceId")?)?;
                entity(c, &p.project_id, required(to, "targetId")?)?;
            }
            let result = transition::<EntityLink>(c, p, rollback)?;
            if p.operation == "create_link" {
                let source = get(c, required(&p.after, "sourceId")?)?;
                let (action, verb) = if rollback {
                    ("rollback", "撤销了关联")
                } else {
                    ("link", "关联了")
                };
                record_activity(c, &source, action, verb)?;
                return Ok(result);
            }
            // Mention links are maintained from entity text on commit. Do not report a
            // successful deletion or restoration that the mention index would reverse.
            if p.before["linkKind"] == "mention" {
                crate::impact::sync_mentions(c, &p.project_id)?;
                let present: bool = c.query_row(
                    "SELECT EXISTS(SELECT 1 FROM entity_links WHERE project_id=? AND source_id=? AND target_id=?
                        AND link_kind='mention' AND (?=0 OR id=?))",
                    params![p.project_id,required(&p.before,"sourceId")?,required(&p.before,"targetId")?,rollback,required(&p.before,"id")?],
                    |row| row.get(0)
                )?;
                if present != rollback {
                    return Err(invalid(
                        "提及关联随来源条目的 [[引用]] 自动生成，请修改来源条目的引用",
                    ));
                }
            }
            (result, format!("AI 删除了关联 {}", p.summary))
        }
        _ => return Err(invalid("未知操作")),
    };
    insert_exact(
        c,
        &ActivityLog {
            id: Uuid::new_v4().to_string(),
            project_id: p.project_id.clone(),
            entity_id: p.target_entity_id.clone(),
            entity_type: p.entity_type.clone(),
            action: if rollback {
                "rollback".into()
            } else {
                p.operation.clone()
            },
            summary: if rollback {
                format!("AI 回滚了 {}", p.summary)
            } else {
                description
            },
            created_at: now(),
        },
    )?;
    Ok(result)
}
fn apply(c: &Connection, p: &mut AiProposal, status: &str) -> Result<()> {
    if p.status != "pending" {
        return Err(invalid("提议已处理"));
    }
    let id = p.target_entity_id.as_deref().ok_or(Error::Missing)?;
    match p.operation.as_str() {
        "create_link" | "delete_link" | "create_map" | "update_map" | "delete_map"
        | "upsert_recipe" | "delete_recipe" => {
            p.after = change_record(c, p, false)?;
        }
        "create_entity" | "update_entity" | "delete_entity" => {
            modules::validate_entity(&p.entity_type)?;
            if p.operation != "create_entity" {
                let current = entity(c, &p.project_id, id)?;
                modules::validate_entity(&current.entity_type)?;
                if !same_content(json!(current), &p.before) {
                    return Err(invalid("条目在审核期间已修改，请重新生成提议"));
                }
            }
            if p.operation == "delete_entity" {
                trash_entity(c, id)?;
                p.after = json!(get::<Entity>(c, id)?);
            } else {
                let item: Entity = serde_json::from_value(p.after.clone())?;
                modules::validate_entity(&item.entity_type)?;
                if item.entity_type != p.entity_type
                    || item.project_id != p.project_id
                    || item.id != id
                    || item.deleted_at.is_some()
                {
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
// A savepoint lets later previews observe earlier operations exactly as they will apply.
// Rolling it back discards simulated rows, audit records and change-log triggers together.
pub(super) fn batch(
    c: &Connection,
    project: &str,
    operations: &[Value],
    mode: &str,
    session: &str,
    summary: Option<&str>,
) -> Result<Vec<AiProposal>> {
    if !matches!(mode, "apply" | "review" | "dry_run") {
        return Err(invalid("未知的批量操作模式"));
    }
    get::<Project>(c, project)?;
    let simulate = mode != "apply" && operations.len() > 1;
    if simulate {
        c.execute_batch("SAVEPOINT ai_preview")?;
    }
    let mut results = Vec::new();
    for (i, op) in operations.iter().enumerate() {
        let mut p = preview(c, project, op)?;
        p.session_id = session.into();
        if let Some(s) = summary {
            p.summary = format!("{s} · {}", p.summary);
        }
        if mode == "apply" {
            apply(c, &mut p, "applied")?;
        } else if simulate && i + 1 < operations.len() {
            apply(c, &mut p.clone(), "applied")?;
        }
        results.push(p);
    }
    if simulate {
        c.execute_batch("ROLLBACK TO ai_preview; RELEASE ai_preview")?;
    }
    if mode == "review" {
        for p in &results {
            put(c, p)?;
        }
    }
    Ok(results)
}
impl Database {
    pub fn create_map(&self, project: &str, fields: &Value) -> Result<MapRecord> {
        self.write(|c| {
            let map = new_map(project, fields)?;
            insert_exact(c, &map)?;
            Ok(map)
        })
    }
    pub fn proposal_batch(
        &self,
        project: &str,
        operations: &[Value],
        mode: &str,
        summary: Option<&str>,
    ) -> Result<Vec<AiProposal>> {
        self.write(|c| {
            batch(
                c,
                project,
                operations,
                mode,
                &Uuid::new_v4().to_string(),
                summary,
            )
        })
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
            if !matches!(
                p.operation.as_str(),
                "create_entity" | "update_entity" | "delete_entity"
            ) {
                change_record(c, &p, true)?;
            } else {
                let current: Entity = get(c, target)?;
                modules::validate_entity(&current.entity_type)?;
                if current.project_id != p.project_id || !same_content(json!(current), &p.after) {
                    return Err(invalid("条目已更改，无法回滚"));
                }
                if p.operation == "create_entity" {
                    trash_entity(c, target)?;
                } else {
                    let original: Entity = serde_json::from_value(p.before.clone())?;
                    modules::validate_entity(&original.entity_type)?;
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
