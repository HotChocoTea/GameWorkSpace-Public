use serde_json::{json, Value};
use std::sync::LazyLock;

pub static ENTITY_FIELDS: LazyLock<Value> = LazyLock::new(|| {
    json!({
        "task":{"phaseId":"id","milestoneId":"id","priority":"string","dueDate":"date","estimateHours":"number","completedAt":"timestamp","subtasks":"[{id,title,done}]","images":"asset[]"},
        "phase":{"startDate":"date","endDate":"date","deliverables":"[{id,text,done}]"},
        "milestone":{"phaseId":"id","dueDate":"date"},
        "calendar_event":{"date":"date","startTime":"HH:mm","endTime":"HH:mm"},
        "doc":{"parentId":"id|null","icon":"string"},
        "lore":{"category":"string","secretTruth":"string","revealStage":"number","secrecy":"string","revealQuestId":"id","era":"string","year":"number","icon":"string","meta":"[{id,label,value}]","coverAsset":"asset"},
        "concept_art":{"coverPreset":"string","boardPosition":"[x,y]","asset":"asset","x":"number","y":"number","width":"number","height":"number","zIndex":"number","tags":"id[]","groupId":"id","kind":"string","color":"color"},
        "character":{"homeId":"id","factionId":"id","locationIds":"id[]","timeline":"[{id,year,when,event}]","role":"string","age":"string","race":"string","appearance":"string","personality":"string","speech":"string","motivation":"string","arc":"string","avatarAsset":"asset"},
        "location":{"parentId":"id|null","locationType":"string","features":"string","inhabitants":"string","coverAsset":"asset","characterIds":"id[]","factionIds":"id[]","questIds":"id[]","questId":"id","factionId":"id","collectibleIds":"id[]","collectibleId":"id","sceneIds":"id[]","sceneId":"id"},
        "faction":{"members":"[{id,rank,role,characterId}]","relations":"[{targetId,level}]","color":"color","attitude":"string","factionType":"string","motto":"string","hqLocationId":"id","territory":"string","goals":"string","ratings":"[{id,label,value}]","diplomacy":"{factionId:tier}","icon":"string","emblemAsset":"asset"},
        "vehicle":{"speed":"number","crew":"number","range":"number","vehicleType":"string","ownerCharacterId":"id","ownerFactionId":"id","appearance":"string","stats":"[{id,label,value}]","specs":"[{id,label,value}]","upgrades":"string","partItemIds":"id[]","imageAsset":"asset"},
        "item":{"craftY":"number","iconAsset":"asset","rarity":"string","stack":"number","category":"string","stackLimit":"number","price":"number","attributes":"[{id,key,value}]","effect":"string","obtainMethod":"string","icon":"string"},
        "collectible":{"iconAsset":"asset","series":"string","number":"number","seriesSize":"number","seriesIndex":"number","seriesTargetCount":"number","category":"string","rarity":"string","implemented":"boolean","hidden":"boolean","locationId":"id","questId":"id","placement":"string","obtainMethod":"string","icon":"string"},
        "quest":{"mapX":"number","laneY":"number","status":"string","category":"string","nodes":"[{id,type,label,x,y,description}]","edges":"[{id,from,to,label}]","locationId":"id","durationMinutes":"number","level":"number","giverId":"id","prerequisites":"id[]","objectives":"[{text,done}]","rewards":"string"},
        "scene":{"locationId":"id","questId":"id","castIds":"id[]","lines":"[{id,speakerId,speakerName,text,mood}]","dialogues":"[{speakerId,text}]"},
        "bug":{"severity":"string","version":"string","foundDate":"date","reproSteps":"string","expected":"string","actual":"string","screenshots":"asset[]"},
        "devlog":{"date":"date","coverAsset":"asset","playtestUrl":"url"}
    })
});

fn object(properties: Value, required: &[&str]) -> Value {
    json!({"type":"object","properties":properties,"required":required,"additionalProperties":false})
}
fn array(items: Value) -> Value {
    json!({"type":"array","items":items})
}
fn extend(mut base: Value, extra: Value) -> Value {
    base.as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    base
}
fn tool(name: &str, description: &str, props: Value, required: &[&str]) -> Value {
    json!({"name":name,"description":description,"inputSchema":object(props,required)})
}
pub static TOOLS: LazyLock<Vec<Value>> = LazyLock::new(|| {
    let id = json!({"type":"string","minLength":1});
    let string = json!({"type":"string"});
    let flag = json!({"type":"boolean"});
    let coord = json!({"type":"integer","minimum":0,"maximum":2147483647});
    let qty = json!({"type":"integer","minimum":1,"maximum":2147483647});
    let num = json!({"type":"number"});
    let limit = json!({"type":"integer","minimum":1,"maximum":200});
    let kind = json!({"type":"string","enum":ENTITY_FIELDS.as_object().unwrap().keys().collect::<Vec<_>>()});
    let project = json!({"projectId":id});
    let entity = json!({"entityId":id});
    let quest = json!({"questId":id});
    let map = json!({"mapId":id});
    let fields = json!({"title":id,"subtitle":string,"summary":string,"body":string,"status":string,"tags":array(string.clone()),"data":{"type":"object"}});
    let link = json!({"sourceId":id,"targetId":id,"relationLabel":id});
    let op = |name: &str, props: Value, required: &[&str]| {
        let mut req = vec!["operation"];
        req.extend_from_slice(required);
        object(extend(props, json!({"operation":{"const":name}})), &req)
    };
    let operations = json!({"type":"array","minItems":1,"items":{"oneOf":[
        op("create_entity",extend(fields.clone(),json!({"entityType":kind})),&["title","entityType"]),
        op("update_entity",json!({"targetEntityId":id,"patch":object(fields.clone(),&[])}),&["targetEntityId","patch"]),
        op("delete_entity",json!({"targetEntityId":id}),&["targetEntityId"]),
        op("create_link",link.clone(),&["sourceId","targetId","relationLabel"])
    ]}});
    let nodes = array(object(
        json!({"id":id,"type":id,"label":string,"x":num,"y":num,"description":string}),
        &["id", "type"],
    ));
    let edges = array(object(
        json!({"id":id,"from":id,"to":id,"label":string}),
        &["from", "to"],
    ));
    let ingredient = object(json!({"itemId":id,"qty":qty}), &["itemId", "qty"]);
    let mut recipe = tool(
        "upsert_crafting_recipe",
        "写入或删除合成配方 / Save or delete a crafting recipe",
        json!({"projectId":id,"id":id,"outputItemId":id,"outputQty":qty,"ingredients":array(ingredient),"tools":array(id.clone()),"note":string,"delete":flag}),
        &["projectId"],
    );
    recipe["inputSchema"]["oneOf"] = json!([
        {"required":["id","delete"],"properties":{"delete":{"const":true}}},
        {"required":["outputItemId","outputQty","ingredients"],"properties":{"delete":{"const":false}}}
    ]);
    vec![
        tool("list_projects","项目列表与指标 / List projects with workspace statistics",json!({}),&[]),
        tool("create_project","新建游戏项目 / Create a game project",json!({"name":id,"pitch":string,"genres":array(string.clone()),"engine":string,"platforms":array(string.clone())}),&["name"]),
        tool("get_project_overview","查看阶段、里程碑和近期活动 / Read project overview",project.clone(),&["projectId"]),
        tool("search_entities","全文或中文短词检索 / Search indexed entity text",json!({"projectId":id,"query":id,"entityType":kind,"limit":limit}),&["projectId","query"]),
        tool("list_entities","筛选并分页 / Filter and page active entities",json!({"projectId":id,"entityType":kind,"status":string,"tag":string,"limit":limit,"offset":coord}),&["projectId"]),
        tool("get_entity","读取条目及双向关联 / Read entity with outgoing links and backlinks",entity.clone(),&["entityId"]),
        tool("create_entity","创建条目 / Create a typed entity",extend(fields.clone(),json!({"projectId":id,"entityType":kind})),&["projectId","entityType","title"]),
        tool("update_entity","更新条目，默认合并 data 字段 / Patch entity, merging data by default",extend(fields.clone(),json!({"entityId":id,"replaceData":flag})),&["entityId"]),
        tool("delete_entity","移入回收站（保留 14 天）/ Move entity to recycle bin",entity.clone(),&["entityId"]),
        tool("restore_entity","恢复回收站条目 / Restore a recycled entity",entity,&["entityId"]),
        tool("link_entities","建立或移除手动关联 / Add or remove a labeled link",extend(link,json!({"projectId":id,"remove":flag})),&["projectId","sourceId","targetId","relationLabel"]),
        tool("get_relationship_graph","关系图含字段引用 / Get graph with manual and field-derived links",project.clone(),&["projectId"]),
        tool("get_quest_flowchart","读取并检查任务流程 / Read and validate quest flow",quest,&["questId"]),
        tool("update_quest_flowchart","保存任务流程并检查可达性 / Save flow and check reachability",json!({"questId":id,"nodes":nodes,"edges":edges,"prerequisites":array(id.clone())}),&["questId","nodes","edges"]),
        tool("list_crafting_recipes","列出合成配方 / List crafting recipes",project.clone(),&["projectId"]),recipe,
        tool("list_maps","列出地图 / List project maps",project,&["projectId"]),
        tool("get_map","读取图层和图钉 / Get map layers and pins",map,&["mapId"]),
        tool("upsert_map_pin","按格坐标设置或移除图钉 / Set or remove pin by grid position",json!({"mapId":id,"label":id,"x":coord,"y":coord,"entityId":id,"remove":flag}),&["mapId","label","x","y"]),
        tool("update_map_tiles","批量更新地图格 / Edit cells in one map layer",json!({"mapId":id,"layerIndex":coord,"edits":array(object(json!({"x":coord,"y":coord,"tileId":coord}),&["x","y","tileId"]))}),&["mapId","layerIndex","edits"]),
        tool("log_time_entry","记录已完成工时 / Log a completed time entry",json!({"projectId":id,"taskId":id,"durationSecs":qty,"note":string,"startedAt":id}),&["projectId","durationSecs"]),
        tool("batch_apply_changes","预览、送审或原子应用改动 / Preview, stage for review, or atomically apply with rollback snapshots",json!({"projectId":id,"operations":operations,"mode":{"enum":["dry_run","review","apply"]},"sessionSummary":string}),&["projectId","operations"]),
        tool("export_agent_bundle","导出 GDD、ZIP 或备份 / Export Markdown, ZIP or portable backup",json!({"projectId":id,"format":{"enum":["markdown","zip","backup"]},"outputPath":id}),&["projectId","format"]),
    ]
});

// Validate the same small JSON Schema vocabulary that tools/list advertises.
pub fn validate(schema: &Value, value: &Value, path: &str) -> Result<(), String> {
    let invalid = || format!("Invalid argument at {path}");
    if let Some(choices) = schema["oneOf"].as_array() {
        if choices
            .iter()
            .filter(|s| validate(s, value, path).is_ok())
            .count()
            != 1
        {
            return Err(invalid());
        }
    }
    if schema.get("const").is_some_and(|v| v != value)
        || schema["enum"]
            .as_array()
            .is_some_and(|v| !v.contains(value))
    {
        return Err(invalid());
    }
    let ok = match schema["type"].as_str() {
        Some("object") => value.is_object(),
        Some("array") => value.is_array(),
        Some("string") => value.is_string(),
        Some("number") => value.is_number(),
        Some("integer") => value.is_i64() || value.is_u64(),
        Some("boolean") => value.is_boolean(),
        _ => true,
    };
    if !ok {
        return Err(invalid());
    }
    if let Some(required) = schema["required"].as_array() {
        for key in required.iter().filter_map(Value::as_str) {
            if value.get(key).is_none() {
                return Err(format!("Missing {path}.{key}"));
            }
        }
    }
    if let Some(obj) = value.as_object() {
        for (key, v) in obj {
            if let Some(s) = schema["properties"].get(key) {
                validate(s, v, &format!("{path}.{key}"))?;
            } else if schema["additionalProperties"] == false {
                return Err(format!("Unknown field {path}.{key}"));
            }
        }
    }
    if let Some(rows) = value.as_array() {
        if rows.len() < schema["minItems"].as_u64().unwrap_or(0) as usize {
            return Err(invalid());
        }
        if let Some(s) = schema.get("items") {
            for (i, item) in rows.iter().enumerate() {
                validate(s, item, &format!("{path}[{i}]"))?;
            }
        }
    }
    if let Some(n) = value.as_f64() {
        if schema["minimum"].as_f64().is_some_and(|min| n < min)
            || schema["maximum"].as_f64().is_some_and(|max| n > max)
        {
            return Err(invalid());
        }
    }
    if schema.get("minLength").is_some() && value.as_str().is_some_and(|s| s.trim().is_empty()) {
        return Err(invalid());
    }
    Ok(())
}
