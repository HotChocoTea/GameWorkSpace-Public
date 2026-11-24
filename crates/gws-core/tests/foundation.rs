use gws_core::{repo::now, seeder::seed_sample_project_if_empty, Database, Entity, Project};
use rusqlite::Connection;
use std::collections::HashSet;
use tempfile::TempDir;

fn empty() -> (TempDir, Database) {
    let dir = TempDir::new().unwrap();
    let db = Database::open(dir.path()).unwrap();
    (dir, db)
}
fn sample() -> (TempDir, Database) {
    let (dir, db) = empty();
    assert!(seed_sample_project_if_empty(&db).unwrap());
    (dir, db)
}
#[test]
fn schema_and_wal_survive_reopen() {
    let (dir, db) = empty();
    assert_eq!(db.journal_mode().unwrap(), "wal");
    drop(db);
    let _db = Database::open(dir.path()).unwrap();
    let c = Connection::open(dir.path().join("gameworkspace.db")).unwrap();
    for table in [
        "projects",
        "entities",
        "entity_links",
        "time_entries",
        "activity_log",
        "maps",
        "crafting_recipes",
        "ai_proposals",
        "ai_messages",
        "app_settings",
        "change_log",
        "entities_fts",
    ] {
        c.prepare(&format!("SELECT * FROM {table}")).unwrap();
    }
}
#[test]
fn crud_trash_restore_and_expiry() {
    let (dir, db) = empty();
    db.save_project(&Project {
        id: "p".into(),
        name: "测试".into(),
        ..Default::default()
    })
    .unwrap();
    let mut e = Entity {
        id: "e".into(),
        project_id: "p".into(),
        entity_type: "doc".into(),
        title: "旧灯塔".into(),
        ..Default::default()
    };
    db.save_entity(&e).unwrap();
    e.title = "新港口".into();
    db.save_entity(&e).unwrap();
    assert!(db.search_entities("p", "旧灯塔", 5).unwrap().is_empty());
    db.soft_delete("e").unwrap();
    assert!(db.list_entities("p").unwrap().is_empty());
    assert!(db.search_entities("p", "港", 5).unwrap().is_empty());
    assert_eq!(db.recycle_bin(Some("p")).unwrap().len(), 1);
    db.restore("e").unwrap();
    assert_eq!(db.list_entities("p").unwrap()[0].title, "新港口");
    db.soft_delete("e").unwrap();
    Connection::open(dir.path().join("gameworkspace.db"))
        .unwrap()
        .execute(
            "UPDATE entities SET deleted_at=datetime('now','-15 days') WHERE id='e'",
            [],
        )
        .unwrap();
    assert!(db.restore("e").is_err());
    assert_eq!(db.purge_expired().unwrap(), 1);
    assert!(db.get_entity("e").is_err());
}
#[test]
fn chinese_short_and_trigram_search() {
    let (_dir, db) = sample();
    for word in ["雾", "灯塔", "白岬灯塔"] {
        assert!(!db
            .search_entities("lightward", word, 20)
            .unwrap()
            .is_empty());
        assert!(db
            .search_entities("elsewhere", word, 20)
            .unwrap()
            .is_empty());
    }
    for literal in ["%", "_", "灯 OR 灯", "\""] {
        db.search_entities("lightward", literal, 5).unwrap();
    }
    assert!(db.search_entities("lightward", "%", 5).unwrap().is_empty());
}
#[test]
fn content_addressed_assets() {
    let (dir, db) = empty();
    let a = db.save_asset(b"pixels", "PNG").unwrap();
    assert_eq!(
        a.filename,
        db.save_asset(b"pixels", "png").unwrap().filename
    );
    assert_eq!(
        std::fs::read(db.resolve_asset_path(&a.filename).unwrap()).unwrap(),
        b"pixels"
    );
    assert_eq!(
        std::fs::read_dir(dir.path().join("assets"))
            .unwrap()
            .count(),
        1
    );
    assert!(db.resolve_asset_path("../gameworkspace.db").is_err());
}
#[test]
fn sample_is_complete_and_only_seeded_once() {
    let (_dir, db) = sample();
    let s = db.export_project("lightward").unwrap();
    assert_eq!(s.project.name, "光域守护（示例）");
    assert_eq!(s.project.enabled_modules.len(), 23);
    assert!(s.project.enabled_modules.iter().any(|id| id == "devlog"));
    for (kind, n) in [
        ("phase", 4),
        ("milestone", 3),
        ("task", 12),
        ("calendar_event", 4),
        ("doc", 5),
        ("lore", 6),
        ("character", 5),
        ("location", 5),
        ("faction", 3),
        ("vehicle", 2),
        ("item", 8),
        ("collectible", 6),
        ("quest", 4),
        ("scene", 3),
        ("bug", 4),
        ("devlog", 3),
        ("concept_art", 2),
    ] {
        assert!(
            s.entities.iter().filter(|e| e.entity_type == kind).count() >= n,
            "{kind}"
        );
    }
    assert_eq!(
        s.entities
            .iter()
            .filter(|e| e.entity_type == "task")
            .map(|e| &e.status)
            .collect::<HashSet<_>>()
            .len(),
        4
    );
    assert!(s
        .entities
        .iter()
        .filter(|e| e.entity_type == "quest")
        .all(|e| e.data["nodes"].as_array().unwrap().len() == 10));
    assert_eq!(s.maps[0].pins.as_array().unwrap().len(), 5);
    for (kind, key) in [
        ("character", "avatarAsset"),
        ("location", "coverAsset"),
        ("vehicle", "imageAsset"),
    ] {
        for entity in s.entities.iter().filter(|e| e.entity_type == kind) {
            assert!(db
                .resolve_asset_path(entity.data[key].as_str().unwrap())
                .unwrap()
                .is_file());
        }
    }
    assert_eq!(s.maps[0].layers.as_array().unwrap().len(), 2);
    assert!(
        s.recipes.len() >= 4
            && s.links.len() >= 20
            && s.time_entries.len() >= 6
            && !s.activity.is_empty()
    );
    assert!(!seed_sample_project_if_empty(&db).unwrap());
    db.delete_project("lightward").unwrap();
    assert!(!seed_sample_project_if_empty(&db).unwrap());
}

#[test]
fn visual_editor_sample_references_survive_project_copy() {
    let (_dir, db) = sample();
    let project = db.duplicate_project("lightward").unwrap();
    let s = db.export_project(&project.id).unwrap();
    let ids: HashSet<_> = s.entities.iter().map(|e| e.id.as_str()).collect();
    let art: Vec<_> = s
        .entities
        .iter()
        .filter(|e| e.entity_type == "concept_art" && e.data["kind"] != "group")
        .collect();
    assert!(art.len() >= 2);
    for card in art {
        assert!(db
            .resolve_asset_path(card.data["asset"].as_str().unwrap())
            .unwrap()
            .is_file());
        assert!(ids.contains(card.data["tags"][0].as_str().unwrap()));
        if let Some(group) = card.data["groupId"].as_str() {
            assert!(ids.contains(group));
        }
    }
    let quest = s
        .entities
        .iter()
        .find(|e| e.title == "绘出失名航道")
        .unwrap();
    assert!(ids.contains(quest.data["prerequisites"][0].as_str().unwrap()));
    for scene in s.entities.iter().filter(|e| e.entity_type == "scene") {
        for line in scene.data["lines"].as_array().unwrap() {
            let speaker = line["speakerId"].as_str().unwrap();
            assert!(speaker == "narrator" || ids.contains(speaker));
        }
    }
}

#[test]
fn duplication_remaps_graph_and_domain_references() {
    let (_dir, db) = sample();
    let mut doc = db.get_entity("doc-1").unwrap();
    doc.body = "location-1".into();
    db.save_entity(&doc).unwrap();
    let copy = db.duplicate_project("lightward").unwrap();
    db.delete_project("lightward").unwrap();
    let s = db.export_project(&copy.id).unwrap();
    assert!(s.entities.iter().any(|e| e.body == "location-1"));
    let ids: HashSet<_> = s.entities.iter().map(|e| e.id.as_str()).collect();
    for l in &s.links {
        assert!(ids.contains(l.source_id.as_str()) && ids.contains(l.target_id.as_str()))
    }
    assert!(ids.contains(s.recipes[0].ingredients[0]["itemId"].as_str().unwrap()));
    assert!(ids.contains(s.maps[0].pins[0]["entityId"].as_str().unwrap()));
    let factions: Vec<_> = s
        .entities
        .iter()
        .filter(|e| e.entity_type == "faction")
        .collect();
    for faction in &factions {
        let diplomacy = faction.data["diplomacy"].as_object().unwrap();
        assert!(!diplomacy.is_empty());
        for (id, tier) in diplomacy {
            let other = factions.iter().find(|e| &e.id == id).unwrap();
            assert_eq!(&other.data["diplomacy"][&faction.id], tier);
        }
        assert!(ids.contains(faction.data["members"][0]["characterId"].as_str().unwrap()));
    }
    assert!(ids.contains(s.recipes[0].tools[0].as_str().unwrap()));
    assert_eq!(db.workspace_stats().unwrap()[0].tasks, 12);
}
#[test]
fn external_changes_are_indexed_and_logged_atomically() {
    let (dir, db) = sample();
    let previous = db.last_change().unwrap();
    let external = Connection::open(dir.path().join("gameworkspace.db")).unwrap();
    external
        .execute(
            "UPDATE entities SET title='三重镜阵',updated_at=?1 WHERE id='doc-2'",
            [now()],
        )
        .unwrap();
    assert!(db.last_change().unwrap() > previous);
    assert_eq!(
        db.search_entities("lightward", "三重镜阵", 1).unwrap()[0].id,
        "doc-2"
    );
}
