use super::*;
use rusqlite::Connection;
use std::sync::LazyLock;

pub static ENTITY_FIELDS: LazyLock<Value> = LazyLock::new(|| {
    json!({
        "task":{"phaseId":"id","milestoneId":"id","priority":"低|中|高|紧急","dueDate":"date","estimateHours":"number","completedAt":"timestamp","subtasks":"[{id,title,done}]","images":"asset[]"},
        "phase":{"startDate":"date","endDate":"date","deliverables":"[{id,title,done}]"},
        "milestone":{"phaseId":"id","dueDate":"date"},
        "calendar_event":{"date":"date","startTime":"HH:mm","endTime":"HH:mm"},
        "doc":{"parentId":"id|null","icon":"string"},
        "lore":{"category":"string","secretTruth":"string","revealStage":"number","secrecy":"公开常识|鲜为人知|禁忌秘密|未设定","revealQuestId":"id","era":"string","year":"number","icon":"string","meta":"[{id,label,value}] (旧数据也可为 {label:string})","coverAsset":"asset"},
        "concept_art":{"coverPreset":"string","boardPosition":"[x,y]","asset":"asset","x":"number","y":"number","width":"number","height":"number","zIndex":"number","tags":"id[]","groupId":"id","kind":"string","color":"color"},
        "character":{"homeId":"id","factionId":"id","locationIds":"id[]","timeline":"[{id,year,when,event}]","role":"string","age":"string","race":"string","appearance":"string","personality":"string","speech":"string","motivation":"string","arc":"string","avatarAsset":"asset"},
        "location":{"parentId":"id|null","locationType":"string","features":"string","inhabitants":"string","coverAsset":"asset","characterIds":"id[]","factionIds":"id[]","questIds":"id[]","questId":"id","factionId":"id","collectibleIds":"id[]","collectibleId":"id","sceneIds":"id[]","sceneId":"id"},
        "faction":{"members":"[{id,rank,role,characterId,customName}]","relations":"[{targetId,level}]","color":"color","attitude":"string","factionType":"string","motto":"string","hqLocationId":"id","territory":"string","goals":"string","ratings":"[{id,label,value}]","diplomacy":"{factionId:tier}","icon":"string","emblemAsset":"asset"},
        "vehicle":{"speed":"number","crew":"number","range":"number","vehicleType":"string","ownerCharacterId":"id","ownerFactionId":"id","appearance":"string","stats":"[{id,label,value}]","specs":"[{id,label,value}]","upgrades":"string","partItemIds":"id[]","imageAsset":"asset"},
        "item":{"craftY":"number","iconAsset":"asset","rarity":"普通|精良|稀有|史诗|传说","stack":"number","category":"string","stackLimit":"number","price":"number","attributes":"[{id,key,value}]","effect":"string","obtainMethod":"string","icon":"string"},
        "collectible":{"iconAsset":"asset","series":"string","number":"number","seriesSize":"number","seriesIndex":"number","seriesTargetCount":"number","category":"string","rarity":"普通|精良|稀有|史诗|传说","implemented":"boolean","hidden":"boolean","locationId":"id","questId":"id","placement":"string","obtainMethod":"string","icon":"string"},
        "quest":{"mapX":"number","laneY":"number","status":"string","category":"string","nodes":"[{id,type:目标|对话|抉择|探索|战斗|解谜|过场|奖励|结局|失败,label,x,y,description}]","edges":"[{id,from,to,label}]","locationId":"id","durationMinutes":"number","level":"number","giverId":"id","prerequisites":"id[]","objectives":"[{text,done}]","rewards":"string"},
        "asset_item":{"asset":"filename","enginePath":"string","category":"立绘|3D模型|动画|特效|BGM|SFX|UI|其他","owner":"string","priority":"低|中|高","linkedEntityIds":"id[]","stage":"未开始|灰盒占位|制作中|已实装|已打磨","originalFilename":"string"},
        "balance_sheet":{"expression":"string","minLevel":"integer","maxLevel":"integer","vars":"{name:number}","formulas":"[{id,name,color,expression}]","overrides":"{formulaId:{level:number}}","entries":"[{id,itemId,name,weight,minQty,maxQty,unitValue}]"},
        "locale_entry":{"key":"string","source":"string","category":"ui|scene|item|quest|character|location|collectible","sourceId":"id","sourcePath":"string","speakerId":"id","translations":"{locale:text}"},
        "scene":{"locationId":"id","questId":"id","castIds":"id[]","lines":"[{id,speakerId,speakerName,text,mood,condition,nextLineId,choices:[{id,text,condition,setVar,nextLineId?}]}]；speakerId 为角色 ID 或 narrator，nextLineId 为台词 ID、空串（顺序播放）或 __END__","dialogues":"[{speakerId,text}]"},
        "bug":{"severity":"致命|严重|一般|轻微","version":"string","foundDate":"date","reproSteps":"string","expected":"string","actual":"string","screenshots":"asset[]"},
        "devlog":{"date":"date","coverAsset":"asset","playtestUrl":"url"}
    })
});

pub(super) struct Module {
    pub id: &'static str,
    pub label: &'static str,
    pub types: &'static [&'static str],
}
const fn module(id: &'static str, label: &'static str, types: &'static [&'static str]) -> Module {
    Module { id, label, types }
}
const MODULES: &[Module] = &[
    module("overview", "概览", &[]),
    module("tasks", "任务", &["task"]),
    module("roadmap", "路线图", &["phase", "milestone"]),
    module("calendar", "日历", &["calendar_event"]),
    module("assets_pipeline", "资产管线", &["asset_item"]),
    module("time", "工时", &[]),
    module("balance", "数值平衡", &["balance_sheet"]),
    module("localization", "本地化", &["locale_entry"]),
    module("docs", "文档", &["doc"]),
    module("lore", "设定集", &["lore"]),
    module("art", "概念图", &["concept_art"]),
    module("characters", "角色", &["character"]),
    module("locations", "地点", &["location"]),
    module("factions", "阵营", &["faction"]),
    module("vehicles", "载具", &["vehicle"]),
    module("inventory", "物品", &["item"]),
    module("collectibles", "收集品", &["collectible"]),
    module("quests", "任务线", &["quest"]),
    module("scenes", "场景对白", &["scene"]),
    module("graph", "关系网", &[]),
    module("mapmaker", "地图设计", &[]),
    module("testing", "Bug 追踪", &["bug"]),
    module("devlog", "开发日志", &["devlog"]),
];
pub(super) fn lookup(id: &str) -> Result<&'static Module> {
    MODULES
        .iter()
        .find(|m| m.id == id)
        .ok_or_else(|| invalid("未知工作区模块"))
}
pub(super) fn validate_entity(kind: &str) -> Result<()> {
    if kind == "calendar_event" {
        Err(invalid("日历模块当前不支持 AI 写入"))
    } else if ENTITY_FIELDS.get(kind).is_none() {
        Err(invalid("不支持的 AI 实体类型"))
    } else {
        Ok(())
    }
}
pub(super) fn is_read_only(id: &str) -> bool {
    matches!(id, "calendar" | "time")
}

fn schema(m: &Module) -> Value {
    let mut fields = json!({});
    for kind in m.types {
        fields[*kind] = ENTITY_FIELDS[*kind].clone();
        fields[*kind]["graphX"] = json!("number");
        fields[*kind]["graphY"] = json!("number");
    }
    match m.id {
        "inventory" => {
            fields["recipes"] = json!({"outputItemId":"item id","outputQty":"integer >=1","ingredients":"[{itemId,qty}]","tools":"item id[]","note":"string"})
        }
        "graph" => {
            fields["entity_links"] =
                json!({"sourceId":"entity id","targetId":"entity id","relationLabel":"string"})
        }
        "mapmaker" => {
            fields["maps"] = json!({"name":"string","width":"1..128","height":"1..128","tileSize":"8..128","layers":"[{name,visible,tiles:number[],icons:[{x,y,iconId}]}]，tiles 也可改用 grid/rows 二维数组或 cells:[{x,y,tileId}]","pins":"[{id,label,x,y,color,entityId}]","customTiles":"[{id:number,name,color}]","tileEdits":"[{layerIndex,x,y,tileId}]","pinUpserts":"[{label,x,y,color,entityId,remove}]"})
        }
        _ => (),
    }
    fields
}

impl Module {
    pub(super) fn metadata(&self, scope: ScopeMode) -> Value {
        let mut meta = json!({"id":self.id,"label":self.label,"scope":scope,"readOnly":is_read_only(self.id),"primaryEntityTypes":self.types,"schema":schema(self)});
        if self.id == "mapmaker" {
            let names = [
                "地面",
                "墙体",
                "道路",
                "草地",
                "水域",
                "门",
                "危险",
                "特殊",
                "沙滩",
                "浅滩",
                "深海",
                "林地",
                "岩石",
                "石板",
                "木栈道",
                "田地",
                "麦田",
                "雾",
                "浅草/装饰",
            ];
            meta["mapTerrains"] = names
                .iter()
                .enumerate()
                .map(|(i, name)| ((i + 1).to_string(), json!(name)))
                .collect::<serde_json::Map<_, _>>()
                .into();
            meta["mapIcons"] = json!([
                "tree", "pine", "rock", "house", "beacon", "tavern", "fire", "chest", "anchor",
                "boat", "ship", "monster", "npc", "star", "flag", "warn"
            ]);
        }
        meta
    }
    pub(super) fn policy(&self, scope: ScopeMode) -> String {
        if self.id == "overview" || scope == ScopeMode::Project {
            return format!("用户发送消息时位于【{}】模块，已选择全项目范围。可以操作任意可写模块，日历和工时只读。请遵守 writableSchemas。", self.label);
        }
        let targets = schema(self)
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>()
            .join("、");
        format!("用户发送消息时位于【{}】模块。当用户提出泛指请求（例如「新建几个示例」「帮我设计一个」）且未指定其他模块时，必须优先针对当前模块（{}）生成对应操作，并严格遵守 activeModule.schema 的数据结构。仅当用户明确提到其他模块或需要关联其他模块条目时，才允许附带跨模块操作。日历和工时只读。",self.label,targets)
    }
}

pub(super) fn writable_schemas() -> Value {
    let mut schemas = json!({});
    for m in MODULES
        .iter()
        .filter(|m| !is_read_only(m.id) && m.id != "overview")
    {
        schemas[m.id] = schema(m);
    }
    schemas
}

pub(super) fn items(c: &Connection, project: &str, m: &Module) -> Result<Value> {
    let mut items = json!({});
    if !m.types.is_empty() || m.id == "graph" {
        let mut stmt=c.prepare("SELECT id,entity_type,substr(title,1,100),substr(status,1,40),substr(summary,1,120) FROM entities
            WHERE project_id=?1 AND deleted_at IS NULL AND (?2='graph' OR entity_type IN (SELECT value FROM json_each(?3))) ORDER BY sort_order,title,id LIMIT 20")?;
        let rows=stmt.query_map(rusqlite::params![project,m.id,json!(m.types).to_string()],|r| Ok(json!({"id":r.get::<_,String>(0)?,"entityType":r.get::<_,String>(1)?,"title":r.get::<_,String>(2)?,"status":r.get::<_,String>(3)?,"summary":r.get::<_,String>(4)?})))?.collect::<rusqlite::Result<Vec<_>>>()?;
        items["entities"] = json!(rows);
    }
    match m.id {
        "mapmaker" => {
            let mut stmt=c.prepare("SELECT id,substr(name,1,100),width,height,json_array_length(layers_json),json_array_length(pins_json) FROM maps WHERE project_id=? ORDER BY name,id LIMIT 20")?;
            let rows=stmt.query_map([project], |r| Ok(json!({"id":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?,"width":r.get::<_,i64>(2)?,"height":r.get::<_,i64>(3)?,"layerCount":r.get::<_,i64>(4)?,"pinCount":r.get::<_,i64>(5)?})))?.collect::<rusqlite::Result<Vec<_>>>()?;
            items["maps"] = json!(rows);
        }
        "graph" => {
            let links = query::<EntityLink>(
                c,
                "WHERE project_id=? ORDER BY created_at,id LIMIT 24",
                [project],
            )?;
            items["links"]=links.iter().map(|l|json!({"id":l.id,"sourceId":l.source_id,"targetId":l.target_id,"relationLabel":limited(&l.relation_label,80),"linkKind":l.link_kind})).collect();
        }
        "inventory" => {
            let recipes = query::<CraftingRecipe>(
                c,
                "WHERE project_id=? ORDER BY created_at,id LIMIT 20",
                [project],
            )?;
            items["recipes"]=recipes.iter().map(|r|json!({"id":r.id,"outputItemId":r.output_item_id,"outputQty":r.output_qty,"ingredients":r.ingredients,"tools":r.tools,"note":limited(&r.note,160)})).collect();
        }
        _ => (),
    }
    Ok(items)
}
pub(super) fn focus(
    c: &Connection,
    project: &str,
    module: &str,
    id: Option<&str>,
) -> Result<Value> {
    let Some(id) = id else { return Ok(Value::Null) };
    if module == "mapmaker" {
        if let Some(map) =
            query::<MapRecord>(c, "WHERE project_id=? AND id=?", [project, id])?.pop()
        {
            let layers: Vec<_> = map
                .layers
                .as_array()
                .into_iter()
                .flatten()
                .map(|l| json!({"name":l["name"],"visible":l["visible"]}))
                .collect();
            return Ok(
                json!({"id":map.id,"name":map.name,"width":map.width,"height":map.height,"tileSize":map.tile_size,"layers":layers,"pins":map.pins,"customTiles":map.custom_tiles}),
            );
        }
    }
    Ok(json!(query::<Entity>(
        c,
        "WHERE project_id=? AND id=? AND deleted_at IS NULL",
        [project, id]
    )?
    .pop()))
}
