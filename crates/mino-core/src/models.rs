use crate::repo::{Column, Record};
use rusqlite::{types::Value as SqlValue, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;

macro_rules! record {
    ($name:ident, $table:literal, $($field:ident: $ty:ty => $column:literal),+ $(,)?) => {
        #[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
        #[serde(rename_all = "camelCase", default)]
        pub struct $name { $(pub $field: $ty),+ }

        impl Record for $name {
            const TABLE: &'static str = $table;
            const COLUMNS: &'static [&'static str] = &[$($column),+];
            fn values(&self) -> Vec<SqlValue> { vec![$(self.$field.encode()),+] }
            fn read(row: &Row<'_>) -> rusqlite::Result<Self> {
                Ok(Self { $($field: Column::read(row, $column)?),+ })
            }
        }
    };
}

record!(Project, "projects",
    id: String => "id",
    name: String => "name",
    pitch: String => "pitch",
    genres: Vec<String> => "genres_json",
    engine: String => "engine",
    platforms: Vec<String> => "platforms_json",
    logo_asset: Option<String> => "logo_asset",
    cover_preset: String => "cover_preset",
    cover_asset: Option<String> => "cover_asset",
    enabled_modules: Vec<String> => "enabled_modules_json",
    task_columns: Value => "task_columns_json",
    current_phase_id: Option<String> => "current_phase_id",
    created_at: String => "created_at",
    updated_at: String => "updated_at"
);

record!(Entity, "entities",
    id: String => "id",
    project_id: String => "project_id",
    entity_type: String => "entity_type",
    title: String => "title",
    subtitle: String => "subtitle",
    summary: String => "summary",
    status: String => "status",
    tags: Vec<String> => "tags_json",
    body: String => "body",
    data: Value => "data_json",
    sort_order: i64 => "sort_order",
    deleted_at: Option<String> => "deleted_at",
    created_at: String => "created_at",
    updated_at: String => "updated_at"
);

record!(EntityLink, "entity_links",
    id: String => "id",
    project_id: String => "project_id",
    source_id: String => "source_id",
    target_id: String => "target_id",
    relation_label: String => "relation_label",
    link_kind: String => "link_kind",
    created_at: String => "created_at"
);

record!(TimeEntry, "time_entries",
    id: String => "id",
    project_id: String => "project_id",
    task_id: Option<String> => "task_id",
    started_at: String => "started_at",
    ended_at: Option<String> => "ended_at",
    duration_secs: i64 => "duration_secs",
    note: String => "note",
    is_running: bool => "is_running",
    created_at: String => "created_at"
);

record!(ActivityLog, "activity_log",
    id: String => "id",
    project_id: String => "project_id",
    entity_id: Option<String> => "entity_id",
    entity_type: String => "entity_type",
    action: String => "action",
    summary: String => "summary",
    created_at: String => "created_at"
);

record!(MapRecord, "maps",
    id: String => "id",
    project_id: String => "project_id",
    name: String => "name",
    width: i64 => "width",
    height: i64 => "height",
    tile_size: i64 => "tile_size",
    layers: Value => "layers_json",
    pins: Value => "pins_json",
    custom_tiles: Value => "custom_tiles_json",
    created_at: String => "created_at",
    updated_at: String => "updated_at"
);

record!(CraftingRecipe, "crafting_recipes",
    id: String => "id",
    project_id: String => "project_id",
    output_item_id: String => "output_item_id",
    output_qty: i64 => "output_qty",
    ingredients: Value => "ingredients_json",
    tools: Value => "tools_json",
    note: String => "note",
    created_at: String => "created_at",
    updated_at: String => "updated_at"
);

record!(AiProposal, "ai_proposals",
    id: String => "id",
    project_id: String => "project_id",
    session_id: String => "session_id",
    target_entity_id: Option<String> => "target_entity_id",
    entity_type: String => "entity_type",
    operation: String => "operation",
    summary: String => "summary",
    before: Value => "before_json",
    after: Value => "after_json",
    status: String => "status",
    created_at: String => "created_at"
);

record!(AiMessage, "ai_messages",
    id: String => "id",
    project_id: String => "project_id",
    session_id: String => "session_id",
    role: String => "role",
    content: String => "content",
    attachments: Value => "attachments_json",
    proposals: Value => "proposals_json",
    created_at: String => "created_at"
);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub id: String,
    pub entity_type: String,
    pub title: String,
    pub summary: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeLogEntry {
    pub seq: i64,
    pub project_id: Option<String>,
    pub source: String,
    pub entity_type: String,
    pub entity_id: String,
    pub action: String,
    pub created_at: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub key: String,
    pub value: Value,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStats {
    pub project_id: String,
    pub tasks: i64,
    pub completed: i64,
    pub entities: i64,
    pub seconds: i64,
    pub milestone: Option<String>,
    pub due_date: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub project: Project,
    #[serde(default)]
    pub entities: Vec<Entity>,
    #[serde(default)]
    pub links: Vec<EntityLink>,
    #[serde(default)]
    pub time_entries: Vec<TimeEntry>,
    #[serde(default)]
    pub activity: Vec<ActivityLog>,
    #[serde(default)]
    pub maps: Vec<MapRecord>,
    #[serde(default)]
    pub recipes: Vec<CraftingRecipe>,
    #[serde(default)]
    pub ai_messages: Vec<AiMessage>,
    #[serde(default)]
    pub ai_proposals: Vec<AiProposal>,
}
