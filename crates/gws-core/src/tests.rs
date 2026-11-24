use crate::{seeder::seed_sample_project_if_empty, *};
use serde_json::json;
use tempfile::tempdir;

#[test]
fn common_terms_at_ten_thousand_entities() {
    let dir = tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    db.save_project(&Project {
        id: "bench".into(),
        name: "检索验证".into(),
        ..Default::default()
    })
    .unwrap();
    db.conn().unwrap().execute_batch("WITH RECURSIVE numbers(i) AS (
        VALUES(1) UNION ALL SELECT i+1 FROM numbers WHERE i<10000)
        INSERT INTO entities(id,project_id,entity_type,title,subtitle,summary,status,tags_json,body,data_json,sort_order,created_at,updated_at)
        SELECT 'doc-'||i,'bench','doc','白岬灯塔航记 '||i,'','雾海航线','','[]','退潮后打开海图，沿灯塔的光束找回白岬航线。','{}',i,'','' FROM numbers").unwrap();
    for term in ["雾", "灯塔", "白岬灯塔"] {
        let mut times = Vec::new();
        for _ in 0..11 {
            let start = std::time::Instant::now();
            assert_eq!(db.search_entities("bench", term, 30).unwrap().len(), 30);
            times.push(start.elapsed());
        }
        times.sort();
        eprintln!("10,000 entities, {term}: median {:?}", times[5]);
    }
}

#[test]
fn connection_enforces_workspace_pragmas() {
    let dir = tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    let conn = db.conn().unwrap();
    for (pragma, expected) in [
        ("foreign_keys", 1),
        ("synchronous", 1),
        ("busy_timeout", 5000),
        ("cache_size", -16000),
        ("user_version", 3),
    ] {
        let actual: i64 = conn
            .pragma_query_value(None, pragma, |row| row.get(0))
            .unwrap();
        assert_eq!(actual, expected, "{pragma}");
    }
}

#[test]
fn domain_updates_deletes_and_settings_round_trip() {
    let dir = tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    seed_sample_project_if_empty(&db).unwrap();
    let mut map = db.list_maps("lightward").unwrap().remove(0);
    map.name = "夜间测绘".into();
    db.save_map(&map).unwrap();
    assert_eq!(db.get_map(&map.id).unwrap().name, map.name);
    db.delete_map(&map.id).unwrap();

    let mut recipe = db.list_recipes("lightward").unwrap().remove(0);
    recipe.output_qty = 2;
    db.save_recipe(&recipe).unwrap();
    assert_eq!(db.get_recipe(&recipe.id).unwrap().output_qty, 2);
    db.delete_recipe(&recipe.id).unwrap();

    let mut timer = db.list_time_entries("lightward").unwrap().remove(0);
    timer.duration_secs = 4500;
    db.save_time_entry(&timer).unwrap();
    assert_eq!(db.get_time_entry(&timer.id).unwrap().duration_secs, 4500);
    db.delete_time_entry(&timer.id).unwrap();

    let mut entry = db.list_activity("lightward").unwrap().remove(0);
    entry.summary = "修订纪要".into();
    db.save_activity(&entry).unwrap();
    assert_eq!(db.get_activity(&entry.id).unwrap().summary, entry.summary);
    db.delete_activity(&entry.id).unwrap();

    db.save_setting("appearance", &json!({"theme":"warm-paper"}))
        .unwrap();
    db.save_setting("appearance", &json!({"theme":"deep-sea"}))
        .unwrap();
    assert_eq!(
        db.get_setting("appearance").unwrap().unwrap().value["theme"],
        "deep-sea"
    );
    db.delete_setting("appearance").unwrap();
    assert!(db.get_setting("appearance").unwrap().is_none());
}

#[test]
fn backlinks_cannot_cross_projects_and_failed_writes_leave_no_changes() {
    let dir = tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    seed_sample_project_if_empty(&db).unwrap();
    let other = db.duplicate_project("lightward").unwrap();
    let mut link = db.list_links("lightward").unwrap().remove(0);
    let id = link.id.clone();
    assert!(db
        .backlinks("lightward", &link.target_id)
        .unwrap()
        .iter()
        .any(|l| l.id == id));
    let seq = db.last_change().unwrap();
    link.project_id = other.id;
    assert!(db.save_link(&link).is_err());
    assert_eq!(db.last_change().unwrap(), seq);
    assert_eq!(db.get_link(&id).unwrap().project_id, "lightward");
    db.delete_link(&id).unwrap();
    assert!(db.get_link(&id).is_err());
}

#[test]
fn phase_one_projects_gain_independent_devlog_toggle_once() {
    let dir = tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    seed_sample_project_if_empty(&db).unwrap();
    db.conn()
        .unwrap()
        .execute_batch(
            "UPDATE projects SET enabled_modules_json=json_array('testing');
        ALTER TABLE projects DROP COLUMN task_columns_json;
        PRAGMA user_version=1;",
        )
        .unwrap();
    drop(db);
    let db = Database::open(dir.path()).unwrap();
    let mut project = db.get_project("lightward").unwrap();
    assert_eq!(
        project.enabled_modules,
        [
            "testing",
            "devlog",
            "assets_pipeline",
            "balance",
            "localization"
        ]
    );
    project.enabled_modules.retain(|m| m == "testing");
    db.save_project(&project).unwrap();
    drop(db);
    let db = Database::open(dir.path()).unwrap();
    assert_eq!(
        db.get_project("lightward").unwrap().enabled_modules,
        ["testing"]
    );
}

#[test]
fn timer_recovers_after_restart_and_copies_as_finished() {
    let dir = tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    seed_sample_project_if_empty(&db).unwrap();
    let mut timer = TimeEntry {
        id: "timer".into(),
        project_id: "lightward".into(),
        task_id: Some("task-1".into()),
        started_at: (chrono::Utc::now() - chrono::Duration::minutes(5)).to_rfc3339(),
        is_running: true,
        ..Default::default()
    };
    db.save_time_entry(&timer).unwrap();
    drop(db);
    let db = Database::open(dir.path()).unwrap();
    let saved = db.get_time_entry("timer").unwrap();
    assert!(saved.is_running && saved.ended_at.is_none());
    assert_eq!(saved.started_at, timer.started_at);
    assert!(db
        .save_time_entry(&TimeEntry {
            id: "other".into(),
            ..timer.clone()
        })
        .is_err());
    let copy = db.duplicate_project("lightward").unwrap();
    assert!(db
        .list_time_entries(&copy.id)
        .unwrap()
        .iter()
        .all(|t| !t.is_running));
    timer.is_running = false;
    timer.ended_at = Some(repo::now());
    timer.duration_secs = 300;
    db.save_time_entry(&timer).unwrap();
    assert_eq!(db.get_time_entry("timer").unwrap().duration_secs, 300);
}

#[test]
fn batch_rolls_back_partial_import_and_logs_completion_once() {
    let dir = tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    seed_sample_project_if_empty(&db).unwrap();
    let mut task = db.get_entity("task-12").unwrap();
    task.status = "已完成".into();
    let seq = db.last_change().unwrap();
    let invalid = Entity {
        id: "invalid".into(),
        title: String::new(),
        ..task.clone()
    };
    assert!(db.save_entity_batch(&[task.clone(), invalid], &[]).is_err());
    assert_eq!(db.last_change().unwrap(), seq);
    db.save_entity(&task).unwrap();
    db.save_entity(&task).unwrap();
    assert_eq!(
        db.list_activity("lightward")
            .unwrap()
            .iter()
            .filter(|a| a.action == "complete" && a.entity_id.as_deref() == Some(&task.id))
            .count(),
        1
    );
}

#[test]
fn canvas_batch_restores_and_removes_as_one_history_step() {
    let dir = tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    seed_sample_project_if_empty(&db).unwrap();
    let id = "concept_art-1".to_owned();
    let gone = std::slice::from_ref(&id);
    db.apply_entity_edits(&[], &[], &[], gone).unwrap();
    let mut card = db.get_entity(&id).unwrap();
    assert!(card.deleted_at.is_some());
    card.data["x"] = 321.into();
    card.deleted_at = None;
    let cards = std::slice::from_ref(&card);
    assert!(db
        .apply_entity_edits(cards, &[], gone, &["missing".into()])
        .is_err());
    assert!(db.get_entity(&id).unwrap().deleted_at.is_some());
    db.apply_entity_edits(cards, &[], gone, &[]).unwrap();
    let restored = db.get_entity(&id).unwrap();
    assert!(restored.deleted_at.is_none());
    assert_eq!(restored.data["x"], 321);
}
