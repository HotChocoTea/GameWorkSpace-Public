CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    pitch TEXT NOT NULL,
    genres_json TEXT NOT NULL CHECK (json_valid(genres_json)),
    engine TEXT NOT NULL,
    platforms_json TEXT NOT NULL CHECK (json_valid(platforms_json)),
    logo_asset TEXT,
    cover_preset TEXT NOT NULL,
    cover_asset TEXT,
    enabled_modules_json TEXT NOT NULL CHECK (json_valid(enabled_modules_json)),
    current_phase_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE entities (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    subtitle TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL,
    tags_json TEXT NOT NULL CHECK (json_valid(tags_json)),
    body TEXT NOT NULL,
    data_json TEXT NOT NULL CHECK (json_valid(data_json)),
    sort_order INTEGER NOT NULL,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, id)
);

CREATE INDEX entities_project_idx ON entities(project_id, deleted_at, entity_type, sort_order);
CREATE INDEX entities_title_idx ON entities(project_id, title COLLATE NOCASE) WHERE deleted_at IS NULL;

CREATE TABLE entity_links (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relation_label TEXT NOT NULL,
    link_kind TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(project_id, source_id) REFERENCES entities(project_id, id) ON DELETE CASCADE,
    FOREIGN KEY(project_id, target_id) REFERENCES entities(project_id, id) ON DELETE CASCADE
);

CREATE INDEX entity_links_project_idx ON entity_links(project_id);

CREATE TABLE time_entries (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_secs INTEGER NOT NULL CHECK (duration_secs >= 0),
    note TEXT NOT NULL,
    is_running INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(project_id, task_id) REFERENCES entities(project_id, id) ON DELETE CASCADE
);

CREATE INDEX time_entries_project_idx ON time_entries(project_id);

CREATE TABLE activity_log (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    entity_id TEXT,
    entity_type TEXT NOT NULL,
    action TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX activity_log_project_idx ON activity_log(project_id);

CREATE TABLE maps (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    width INTEGER NOT NULL CHECK (width > 0),
    height INTEGER NOT NULL CHECK (height > 0),
    tile_size INTEGER NOT NULL CHECK (tile_size > 0),
    layers_json TEXT NOT NULL CHECK (json_valid(layers_json)),
    pins_json TEXT NOT NULL CHECK (json_valid(pins_json)),
    custom_tiles_json TEXT NOT NULL CHECK (json_valid(custom_tiles_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX maps_project_idx ON maps(project_id);

CREATE TABLE crafting_recipes (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    output_item_id TEXT NOT NULL,
    output_qty INTEGER NOT NULL CHECK (output_qty > 0),
    ingredients_json TEXT NOT NULL CHECK (json_valid(ingredients_json)),
    tools_json TEXT NOT NULL CHECK (json_valid(tools_json)),
    note TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(project_id, output_item_id) REFERENCES entities(project_id, id) ON DELETE CASCADE
);

CREATE INDEX crafting_recipes_project_idx ON crafting_recipes(project_id);

CREATE TABLE ai_proposals (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    target_entity_id TEXT,
    entity_type TEXT NOT NULL,
    operation TEXT NOT NULL,
    summary TEXT NOT NULL,
    before_json TEXT NOT NULL CHECK (json_valid(before_json)),
    after_json TEXT NOT NULL CHECK (json_valid(after_json)),
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX ai_proposals_project_idx ON ai_proposals(project_id);

CREATE TABLE ai_messages (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    attachments_json TEXT NOT NULL CHECK (json_valid(attachments_json)),
    proposals_json TEXT NOT NULL CHECK (json_valid(proposals_json)),
    created_at TEXT NOT NULL
);

CREATE INDEX ai_messages_project_idx ON ai_messages(project_id);

CREATE INDEX backlinks_idx ON entity_links(project_id, target_id);
CREATE TABLE app_settings (key TEXT PRIMARY KEY NOT NULL, value_json TEXT NOT NULL CHECK(json_valid(value_json)), updated_at TEXT NOT NULL);
CREATE TABLE change_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, source TEXT NOT NULL DEFAULT 'sqlite', entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX logged_assets_idx ON change_log(entity_id) WHERE entity_type='asset' AND action='save';
CREATE VIRTUAL TABLE entities_fts USING fts5(entity_id UNINDEXED, project_id UNINDEXED, entity_type UNINDEXED, title, subtitle, summary, body, tags_text, tokenize='trigram');

-- Trigrams cannot match short CJK terms. Index distinct unigrams and bigrams per entity.
CREATE TABLE short_terms(project_id TEXT NOT NULL, term TEXT NOT NULL, entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE, PRIMARY KEY(project_id,term,entity_id)) WITHOUT ROWID;
CREATE INDEX short_terms_entity_idx ON short_terms(entity_id);
CREATE TRIGGER search_remove BEFORE DELETE ON entities BEGIN
  DELETE FROM entities_fts WHERE rowid=OLD.rowid;
END;
CREATE TRIGGER search_replace BEFORE UPDATE ON entities BEGIN
  DELETE FROM entities_fts WHERE rowid=OLD.rowid;
  DELETE FROM short_terms WHERE entity_id=OLD.id;
END;

CREATE TRIGGER search_insert AFTER INSERT ON entities WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO entities_fts(rowid,entity_id,project_id,entity_type,title,subtitle,summary,body,tags_text)
  VALUES(NEW.rowid,NEW.id,NEW.project_id,NEW.entity_type,NEW.title,NEW.subtitle,NEW.summary,NEW.body,NEW.tags_json);
  INSERT OR IGNORE INTO short_terms(project_id,term,entity_id)
  WITH RECURSIVE document(s) AS (SELECT lower(NEW.title || char(10) || NEW.subtitle || char(10) || NEW.summary || char(10) || NEW.body || char(10) || NEW.tags_json)),
    positions(n, size) AS (SELECT 1,length(s) FROM document UNION ALL SELECT n+1,size FROM positions WHERE n<size)
  SELECT DISTINCT NEW.project_id,substr(s,n,width),NEW.id FROM document,positions,(SELECT 1 AS width UNION ALL SELECT 2);
END;

CREATE TRIGGER search_update AFTER UPDATE ON entities WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO entities_fts(rowid,entity_id,project_id,entity_type,title,subtitle,summary,body,tags_text)
  VALUES(NEW.rowid,NEW.id,NEW.project_id,NEW.entity_type,NEW.title,NEW.subtitle,NEW.summary,NEW.body,NEW.tags_json);
  INSERT OR IGNORE INTO short_terms(project_id,term,entity_id)
  WITH RECURSIVE document(s) AS (SELECT lower(NEW.title || char(10) || NEW.subtitle || char(10) || NEW.summary || char(10) || NEW.body || char(10) || NEW.tags_json)),
    positions(n, size) AS (SELECT 1,length(s) FROM document UNION ALL SELECT n+1,size FROM positions WHERE n<size)
  SELECT DISTINCT NEW.project_id,substr(s,n,width),NEW.id FROM document,positions,(SELECT 1 AS width UNION ALL SELECT 2);
END;
