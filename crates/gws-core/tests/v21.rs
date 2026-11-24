use gws_core::{
    assets::mime_type, balance::*, engine_sync::*, impact::analyze_entity_impact, integrations::*,
    localization::*, snapshots::*, *,
};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, path::Path};
use tempfile::TempDir;

fn workspace() -> (TempDir, Database) {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("source")).unwrap();
    db.save_project(&Project {
        id: "p".into(),
        name: "Game".into(),
        ..Default::default()
    })
    .unwrap();
    (dir, db)
}
fn entity(kind: &str, id: &str, data: Value) -> Entity {
    Entity {
        id: id.into(),
        project_id: "p".into(),
        entity_type: kind.into(),
        title: id.into(),
        data,
        ..Default::default()
    }
}
#[test]
fn migration_with_open_wal_copies_payload_and_switches_only_after_verification() {
    let (dir, db) = workspace();
    let root = dir.path().join("config");
    let agent = Database::open_mcp(db.data_dir()).unwrap();
    let other = dir.path().join("new workspace");
    agent
        .save_entity(&entity("item", "ruby", json!({})))
        .unwrap();
    let asset = agent.save_asset(b"audio", "mp3").unwrap();
    fs::write(db.data_dir().join("secrets.bin"), b"opaque encrypted bytes").unwrap();
    create_snapshot(&db, None, "before move").unwrap();
    assert!(migrate_at(db.data_dir(), &db.data_dir().join("nested"), &root).is_err());
    fs::create_dir(&other).unwrap();
    fs::write(other.join("unrelated"), b"data").unwrap();
    assert!(migrate_at(db.data_dir(), &other, &root).is_err());
    assert_eq!(fs::read(other.join("unrelated")).unwrap(), b"data");
    assert!(!root
        .join("com.gameworkspace.app/workspace-location.json")
        .exists());
    fs::remove_file(other.join("unrelated")).unwrap();
    assert!(
        migrate_at(db.data_dir(), &other, &root)
            .unwrap()
            .restart_required
    );
    assert_eq!(resolve_location(&root).unwrap(), other);
    let copy = Database::open(&other).unwrap();
    assert_eq!(copy.get_entity("ruby").unwrap().entity_type, "item");
    assert_eq!(
        fs::read(copy.resolve_asset_path(&asset.filename).unwrap()).unwrap(),
        b"audio"
    );
    assert_eq!(
        fs::read(other.join("secrets.bin")).unwrap(),
        b"opaque encrypted bytes"
    );
    assert_eq!(list_snapshots(&other).unwrap()[0].label, "before move");
    assert!(agent
        .save_entity(&entity("item", "stale", json!({})))
        .is_err());
    assert!(db.save_setting("stale", &true).is_err());
    copy.save_setting("new", &true).unwrap();
}
#[test]
fn failed_pointer_publication_leaves_both_workspaces_consistent() {
    let (dir, db) = workspace();
    let target = dir.path().join("target");
    let root = dir.path().join("settings");
    fs::create_dir_all(root.join("com.gameworkspace.app/workspace-location.json")).unwrap();
    assert!(migrate_at(db.data_dir(), &target, &root).is_err());
    assert_eq!(fs::read_dir(target).unwrap().count(), 0);
    db.save_setting("stillWritable", &true).unwrap();
}
#[test]
fn rolling_snapshots_are_portable_and_collision_safe() {
    let (_dir, db) = workspace();
    let asset = db.save_asset(b"wave", "wav").unwrap();
    db.save_entity(&entity(
        "asset_item",
        "music",
        json!({"asset":asset.filename}),
    ))
    .unwrap();
    db.save_setting("snapshots:auto", &false).unwrap();
    assert!(daily_snapshot(&db).unwrap().is_none());
    db.save_setting("snapshots:auto", &true).unwrap();
    let daily = daily_snapshot(&db).unwrap().unwrap();
    assert!(daily_snapshot(&db).unwrap().is_none());
    for i in 0..8 {
        create_snapshot(&db, Some("p"), &format!("manual {i}")).unwrap();
    }
    let list = list_snapshots(db.data_dir()).unwrap();
    assert_eq!(list.len(), 7);
    assert_eq!(list[0].label, "manual 7");
    assert!(!db
        .data_dir()
        .join("snapshots")
        .join(daily.filename)
        .exists());
    let snapshot = &list[0];
    assert!(snapshot.size_bytes > 0);
    assert!(restore_snapshot(&db, "../gameworkspace.db").is_err());
    let restored = restore_snapshot(&db, &snapshot.filename).unwrap();
    assert_eq!(restored.len(), 1);
    assert_ne!(restored[0].id, "p");
    assert_eq!(
        db.list_entities(&restored[0].id).unwrap()[0].data["asset"],
        asset.filename
    );
    fs::write(
        db.data_dir().join("snapshots").join(&snapshot.filename),
        b"invalid",
    )
    .unwrap();
    assert!(restore_snapshot(&db, &snapshot.filename).is_err());
    assert_eq!(db.list_projects().unwrap().len(), 2);
}
#[test]
fn daily_snapshot_runs_again_after_twenty_four_hours() {
    let (_dir, db) = workspace();
    let first = daily_snapshot(&db).unwrap().unwrap();
    let path = db.data_dir().join("snapshots").join(first.filename);
    let mut old: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    old["exportedAt"] = json!((chrono::Utc::now() - chrono::Duration::hours(25)).to_rfc3339());
    fs::write(path, serde_json::to_vec(&old).unwrap()).unwrap();
    assert!(daily_snapshot(&db).unwrap().is_some());
}
#[test]
fn impact_includes_each_domain_and_excludes_recycled_entities() {
    let (_dir, db) = workspace();
    let target = "target";
    db.save_entity_batch(&[
        entity("item",target,json!({})),entity("item","output",json!({})),
        entity("scene","dialogue",json!({"locationId":target,"questId":target,"castIds":[target],"lines":[{"speakerId":target,"text":"[[target]]"}]})),
        entity("quest","quest",json!({"giverId":target,"locationId":target,"prerequisites":[target]})),
        entity("location","place",json!({"parentId":target})),entity("faction","group",json!({"hqLocationId":target,"members":[{"characterId":target}]})),
        entity("vehicle","ship",json!({"ownerCharacterId":target,"ownerFactionId":target,"partItemIds":[target]})),
        entity("collectible","treasure",json!({"questId":target,"locationId":target})),entity("asset_item","art",json!({"linkedEntityIds":[target]})),
        entity("doc","old",json!({"note":"[[target]]"}))],&[]).unwrap();
    db.soft_delete("old").unwrap();
    db.save_link(&EntityLink {
        id: "out".into(),
        project_id: "p".into(),
        source_id: target.into(),
        target_id: "quest".into(),
        relation_label: "trigger".into(),
        link_kind: "manual".into(),
        ..Default::default()
    })
    .unwrap();
    for (id, out, ingredients, tools) in [
        ("a", target, json!([]), json!([])),
        ("b", "output", json!([{"itemId":target}]), json!([])),
        ("c", "output", json!([]), json!([target])),
    ] {
        db.save_recipe(&CraftingRecipe {
            id: id.into(),
            project_id: "p".into(),
            output_item_id: out.into(),
            output_qty: 1,
            ingredients,
            tools,
            ..Default::default()
        })
        .unwrap();
    }
    db.save_map(&MapRecord {
        id: "map".into(),
        project_id: "p".into(),
        name: "Town".into(),
        width: 1,
        height: 1,
        tile_size: 24,
        pins: json!([{"entityId":target,"label":"gate"}]),
        ..Default::default()
    })
    .unwrap();
    let r = analyze_entity_impact(&db, "p", target).unwrap();
    assert_eq!(
        (
            r.incoming_links.len(),
            r.outgoing_links.len(),
            r.crafting_recipes.len(),
            r.map_pins.len()
        ),
        (1, 1, 3, 1)
    );
    assert_eq!(
        (
            r.scene_references.len(),
            r.quest_references.len(),
            r.field_references.len(),
            r.mentions_in_text.len()
        ),
        (4, 3, 9, 1)
    );
    assert_eq!(r.total_references, 23);
    assert!(analyze_entity_impact(&db, "other", target).is_err());
}
#[test]
fn mention_links_follow_edits_without_duplicating_manual_links() {
    let (_dir, db) = workspace();
    let mut doc = entity("doc", "doc", json!({}));
    doc.body = "[[rune]] [[rune]]".into();
    db.save_entity_batch(&[entity("item", "rune", json!({})), doc.clone()], &[])
        .unwrap();
    assert_eq!(db.backlinks("p", "rune").unwrap().len(), 1);
    let manual = EntityLink {
        id: "manual".into(),
        project_id: "p".into(),
        source_id: "doc".into(),
        target_id: "rune".into(),
        link_kind: "manual".into(),
        relation_label: "uses".into(),
        ..Default::default()
    };
    db.save_link(&manual).unwrap();
    assert_eq!(db.backlinks("p", "rune").unwrap()[0].id, "manual");
    assert_eq!(db.list_links("p").unwrap().len(), 1);
    db.delete_link("manual").unwrap();
    assert_eq!(db.list_links("p").unwrap()[0].link_kind, "mention");
    db.edit_entity("doc", |e| {
        e.body.clear();
        Ok(())
    })
    .unwrap();
    assert!(db.list_links("p").unwrap().is_empty());
}

#[test]
fn evaluator_precedence_domains_variables_and_functions() {
    let vars = Variables::from([("scale".into(), 2.)]);
    for (expr, n) in [
        ("-2^2 + 2^-2", -3.75),
        ("2^3^2", 512.),
        ("max(1,3,2)+min(4,2)", 5.),
        ("floor(2.8)+ceil(1.2)+round(3.6)", 8.),
        ("sqrt(9)+abs(-2)+ln(e)+log(100)", 8.),
        ("clamp(level*scale+x,1,10)", 3.),
        ("pi/pi+2e-1", 1.2),
    ] {
        let curve = evaluate_curve(expr, 1, 2, &vars).unwrap();
        assert_eq!(curve.len(), 2);
        assert!((curve[0].value - n).abs() < 1e-10, "{expr}");
    }
    for bad in [
        "1/0",
        "sqrt(-1)",
        "1+",
        "(1",
        "foo",
        "clamp(1,3,2)",
        "2(3)",
        "2+1 trailing",
        "1e999",
        "unknown(4)",
    ] {
        assert!(evaluate_curve(bad, 1, 1, &vars).is_err(), "{bad}");
    }
    assert!(evaluate_curve("1", i32::MIN, i32::MAX, &vars).is_err());
}
#[test]
fn seeded_drop_simulation_matches_weighted_expectations() {
    let table = [
        DropEntry {
            id: "none".into(),
            weight: 0.,
            value: 999.,
        },
        DropEntry {
            id: "coin".into(),
            weight: 3.,
            value: 1.,
        },
        DropEntry {
            id: "gem".into(),
            weight: 1.,
            value: 9.,
        },
    ];
    let sim = simulate_drop_table(&table, 50000, 42).unwrap();
    assert_eq!(sim.expected_value, 3.);
    assert_eq!(sim.entries[0].count, 0);
    assert_eq!(sim.entries[2].probability, 0.25);
    assert_eq!(sim.entries.iter().map(|e| e.count).sum::<u32>(), 50000);
    assert!((sim.entries[2].drop_rate - 0.25).abs() < 0.01);
    assert_eq!(
        sim.entries[2].count,
        simulate_drop_table(&table, 50000, 42).unwrap().entries[2].count
    );
    assert!(simulate_drop_table(&[], 1, 1).is_err());
    assert!(simulate_drop_table(&table, 0, 1).is_err());
}
#[test]
fn audio_formats_round_trip_with_protocol_mime_types() {
    let (_dir, db) = workspace();
    for (ext, mime) in [
        ("MP3", "audio/mpeg"),
        ("wav", "audio/wav"),
        ("ogg", "audio/ogg"),
        ("flac", "audio/flac"),
        ("m4a", "audio/mp4"),
        ("webm", "audio/webm"),
    ] {
        let info = db.save_asset(b"audio bytes", ext).unwrap();
        assert_eq!(mime_type(&info.filename), mime);
        assert_eq!(
            fs::read(db.resolve_asset_path(&info.filename).unwrap()).unwrap(),
            b"audio bytes"
        );
    }
    assert!(db.save_asset(b"audio", "../wav").is_err());
}
fn read_json(path: &Path) -> Value {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}
#[test]
fn all_engine_presets_emit_deterministic_loadable_data() {
    let (dir, db) = workspace();
    let out = dir.path().join("engine");
    let mut cfg = EngineConfig {
        target_dir: out.clone(),
        preset: Preset::Unity,
        ..Default::default()
    };
    let music = db.save_asset(b"sound", "ogg").unwrap();
    db.save_entity_batch(&[entity("character","Ada",json!({})),entity("asset_item","music",json!({"asset":music.filename})),entity("item","gem",json!({"price":3})),entity("quest","quest",json!({})),
        entity("scene","Dock",json!({"lines":[{"id":"a","speakerId":"Ada","text":"Come along.","condition":"$ready","choices":[{"text":"Go","nextLineId":"c"}],"nextLineId":"b"},{"id":"b","text":"Wait"},{"id":"c","text":"Hello"}]}))],&[]).unwrap();
    db.save_map(&MapRecord {
        id: "m".into(),
        project_id: "p".into(),
        name: "../Town".into(),
        width: 2,
        height: 2,
        tile_size: 16,
        layers: json!([{"name":"ground","tiles":[1,2]}]),
        pins: json!([{"x":1,"y":0,"entityId":"Ada","label":"dock"}]),
        ..Default::default()
    })
    .unwrap();
    upsert_localization(
        &db,
        "p",
        &[LocaleEntry {
            key: "dock.open".into(),
            source: Some("码头,开门".into()),
            translations: BTreeMap::from([("en-US".into(), "Open, please".into())]),
        }],
    )
    .unwrap();
    let result = sync_project_to_engine(&db, "p", &cfg).unwrap();
    assert_eq!(
        result.total_bytes,
        result.file_sizes.values().sum::<usize>()
    );
    for name in &result.files_written {
        let path = out.join(name);
        assert_eq!(
            fs::metadata(&path).unwrap().len(),
            result.file_sizes[name] as u64
        );
        if name.ends_with(".json") {
            assert!(read_json(&path).is_array())
        }
    }
    assert_eq!(read_json(&out.join("items.json"))[0]["data"]["price"], 3);
    let map = read_json(&out.join("maps/Town.tmj"));
    assert_eq!(map["version"], "1.10");
    assert_eq!(map["layers"][0]["data"], json!([1, 2, 0, 0]));
    assert_eq!(map["layers"][1]["type"], "objectgroup");
    assert_eq!(
        map["layers"][1]["objects"][0]["properties"][0]["value"],
        "Ada"
    );
    assert_eq!(&fs::read(out.join("maps/Town.bmp")).unwrap()[..2], b"BM");
    let yarn = fs::read_to_string(out.join("dialogue.yarn")).unwrap();
    for text in [
        "title: Dock\n---",
        "Ada: Come along.",
        "<<if $ready>>",
        "<<endif>>",
        "-> Go\n    <<jump Dock_L3>>",
    ] {
        assert!(yarn.contains(text), "{text}");
    }
    for line in yarn
        .lines()
        .filter_map(|l| l.trim().strip_prefix("<<jump "))
    {
        assert!(yarn.contains(&format!("title: {}\n", line.trim_end_matches(">>"))));
    }
    let csv = fs::read(out.join("localization.csv")).unwrap();
    assert!(csv.starts_with(&[0xef, 0xbb, 0xbf]));
    let mut csv = csv::Reader::from_reader(&csv[3..]);
    assert_eq!(
        csv.headers().unwrap().iter().collect::<Vec<_>>(),
        ["key", "source_zh", "en-US", "ja-JP"]
    );
    assert_eq!(&csv.records().next().unwrap().unwrap()[2], "Open, please");
    let cs = fs::read_to_string(out.join("GameWorkSpaceData.cs")).unwrap();
    assert!(cs.contains("[Serializable]"));
    assert!(cs.contains("JsonUtility.FromJson"));
    let contents: Vec<_> = result
        .files_written
        .iter()
        .map(|f| fs::read(out.join(f)).unwrap())
        .collect();
    let again = sync_project_to_engine(&db, "p", &cfg).unwrap();
    assert_eq!(result.files_written, again.files_written);
    for (f, b) in again.files_written.iter().zip(contents) {
        assert_eq!(fs::read(out.join(f)).unwrap(), b);
    }
    cfg.preset = Preset::Godot;
    sync_project_to_engine(&db, "p", &cfg).unwrap();
    let gd = fs::read_to_string(out.join("game_workspace_data.gd")).unwrap();
    assert!(gd.contains("Array[Entity]"));
    assert!(gd.contains("JSON.parse_string"));
    cfg.preset = Preset::Unreal;
    sync_project_to_engine(&db, "p", &cfg).unwrap();
    for name in ["Items", "Quests", "Localization"] {
        let bytes = fs::read(out.join(format!("DT_{name}.csv"))).unwrap();
        assert_eq!(
            &csv::Reader::from_reader(bytes.as_slice())
                .headers()
                .unwrap()[0],
            "Name"
        );
    }
    fs::write(out.join("DT_Items.csv"), b"user edited").unwrap();
    cfg.preset = Preset::Generic;
    cfg.include_maps = false;
    cfg.include_yarn = false;
    cfg.include_localization = false;
    let plain = sync_project_to_engine(&db, "p", &cfg).unwrap();
    assert!(!plain
        .files_written
        .iter()
        .any(|f| f.ends_with(".tmj") || f.ends_with(".yarn") || f.contains("localization")));
    assert!(!out.join("dialogue.yarn").exists());
    assert!(!out.join("maps/Town.tmj").exists());
    assert_eq!(fs::read(out.join("DT_Items.csv")).unwrap(), b"user edited");
    cfg.target_dir = db.data_dir().into();
    assert!(sync_project_to_engine(&db, "p", &cfg).is_err());
}

mod common;

#[test]
fn model_ids_sort_by_provider_timestamps_and_keep_ties_in_api_order() {
    let openai = json!({"data":[
        {"id":"unknown","created_at":"later"}, {"id":" older ", "created":-1},
        {"id":" first ", "created":2}, {"id":"second","created":2},
        {"id":"newest","created":u64::MAX}, {"id":"older","created":0}, {"id":" "}
    ]});
    assert_eq!(
        ai::parse_model_ids(&openai),
        ["newest", "first", "second", "older", "unknown"]
    );
    let anthropic = json!({"data":[
        {"id":"undated"}, {"id":"old","created_at":"2025-02-01T09:00:00+09:00"},
        {"id":"new","created_at":"2025-02-01T01:00:00Z"}
    ]});
    assert_eq!(ai::parse_model_ids(&anthropic), ["new", "old", "undated"]);
}

#[test]
fn model_ids_support_ollama_and_undated_or_empty_lists() {
    let ollama = json!({"models":[{"name":" local:7b "}, {"id":"next","name":"ignored"}, {"name":"local:7b"}]});
    assert_eq!(ai::parse_model_ids(&ollama), ["local:7b", "next"]);
    assert_eq!(
        ai::parse_model_ids(&json!({"data":[{"id":"b"},{"id":"a"},{"id":"b"}]})),
        ["b", "a"]
    );
    for empty in [
        json!({}),
        json!({"data":[]}),
        json!({"models":[null,{"id":"  "}]}),
    ] {
        assert!(ai::parse_model_ids(&empty).is_empty());
    }
}

#[tokio::test]
async fn fetch_models_reads_the_configured_endpoint_and_rejects_unusable_responses() {
    let (_dir, db) = workspace();
    let mut config = ai::providers()
        .into_iter()
        .find(|p| p.id == "ollama")
        .unwrap();
    let (url, request) = common::server(
        r#"{"data":[{"id":"old","created":1},{"id":"new","created":2}]}"#.into(),
        false,
    )
    .await;
    config.base_url = format!("{url}/v1/");
    assert_eq!(db.fetch_models(&config).await.unwrap(), ["new", "old"]);
    assert!(request
        .await
        .unwrap()
        .starts_with("GET /v1/models HTTP/1.1"));
    for (body, message) in [("not json", "有效 JSON"), ("{}", "未返回可用模型")] {
        let (url, request) = common::server(body.into(), false).await;
        config.base_url = url;
        assert!(db
            .fetch_models(&config)
            .await
            .unwrap_err()
            .to_string()
            .contains(message));
        request.await.unwrap();
    }
}

#[cfg(windows)]
#[tokio::test]
async fn fetch_models_authenticates_and_keeps_echoed_keys_out_of_settings() {
    let (_dir, db) = workspace();
    let mut config = ai::providers()
        .into_iter()
        .find(|p| p.id == "anthropic")
        .unwrap();
    let key = "mock-model-list-credential";
    db.set_api_key(&config.id, key).unwrap();
    let (url, request) = common::server(json!({"data":[{"id":key}]}).to_string(), false).await;
    config.base_url = url;
    let error = db.fetch_models(&config).await.unwrap_err().to_string();
    assert!(error.contains("API Key") && !error.contains(key));
    let headers = request.await.unwrap().to_lowercase();
    assert!(headers.contains("x-api-key: mock-model-list-credential"));
    assert!(headers.contains("anthropic-version: 2023-06-01"));
}

#[test]
fn direct_tiled_export_uses_chosen_stem_and_rolls_back_on_failure() {
    let dir = tempfile::tempdir().unwrap();
    let map = MapRecord {
        width: 1,
        height: 1,
        tile_size: 24,
        ..Default::default()
    };
    let path = dir.path().join("另存地图.tmj");
    let atlas = path.with_extension("bmp");
    write_map_tiled(&map, &path).unwrap();
    assert_eq!(read_json(&path)["tilesets"][0]["image"], "另存地图.bmp");
    assert!(fs::read(&atlas).unwrap().starts_with(b"BM"));
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    fs::write(&atlas, b"previous atlas").unwrap();
    assert!(write_map_tiled(&map, &path).is_err());
    assert_eq!(fs::read(&atlas).unwrap(), b"previous atlas");
    fs::remove_file(&atlas).unwrap();
    assert!(write_map_tiled(&map, &path).is_err());
    assert!(!atlas.exists());
}

#[test]
fn extraction_preserves_translations_and_tracks_branch_choices_and_copies() {
    let (_dir, db) = workspace();
    db.save_entity_batch(&[
        entity("character","captain",json!({})),
        entity("item","rope",json!({})),
        entity("scene","port",json!({"lines":[{"id":"hail","speakerId":"captain","text":"靠岸！","choices":[{"id":"yes","text":"放下舷梯。"}]}]})),
        entity("scene","old",json!({"dialogues":[{"text":"旧对白"}]})),
        entity("scene","removed",json!({"lines":[{"text":"已删除"}]}))
    ],&[]).unwrap();
    db.soft_delete("removed").unwrap();
    let first = extract_project_localization(&db, "p").unwrap();
    assert_eq!((first.added, first.total, first.updated), (7, 7, 0));
    let entries = db
        .entity_page("p", Some("locale_entry"), None, None, 100, 0)
        .unwrap();
    let choice = entries
        .iter()
        .find(|e| e.data["source"] == "放下舷梯。")
        .unwrap();
    assert_eq!(choice.data["sourcePath"], "line.hail.choice.yes");
    let line = entries
        .iter()
        .find(|e| e.data["source"] == "靠岸！")
        .unwrap();
    assert_eq!(line.data["speakerId"], "captain");
    save_locale_translation(&db, "p", &choice.id, "en-US", "Lower the gangway.").unwrap();
    db.edit_entity("port", |s| {
        s.data["lines"][0]["choices"][0]["text"] = json!("放下舷梯！");
        Ok(())
    })
    .unwrap();
    let second = extract_project_localization(&db, "p").unwrap();
    assert_eq!((second.total, second.added, second.updated), (7, 0, 1));
    let saved = db.get_entity(&choice.id).unwrap();
    assert_eq!(saved.data["translations"]["en-US"], "Lower the gangway.");
    assert_eq!(saved.data["source"], "放下舷梯！");
    let copy = db.duplicate_project("p").unwrap();
    let repeat = extract_project_localization(&db, &copy.id).unwrap();
    assert_eq!((repeat.total, repeat.added, repeat.updated), (7, 0, 0));
}

#[cfg(windows)]
#[tokio::test]
async fn localized_voice_uses_byok_without_persisting_or_echoing_credentials() {
    use ai::ReasoningTier;
    let (_dir, db) = workspace();
    let mut project = db.get_project("p").unwrap();
    project.pitch = "孤岛寻灯".into();
    project.genres = vec!["叙事冒险".into()];
    db.save_project(&project).unwrap();
    let mut place = entity("location", "pier", json!({}));
    place.summary = "潮声盖过了钟声。".into();
    db.save_entity_batch(
        &[
            place,
            entity(
                "character",
                "岑",
                json!({"role":"守灯人","personality":"沉着","speechStyle":"短句，先报风向"}),
            ),
            entity(
                "scene",
                "sea",
                json!({"lines":[{"id":"ask","text":"起风了。","speakerId":"岑"}]}),
            ),
        ],
        &[],
    )
    .unwrap();
    extract_project_localization(&db, "p").unwrap();
    let rows = db
        .entity_page("p", Some("locale_entry"), None, None, 100, 0)
        .unwrap();
    let line = &rows
        .iter()
        .find(|e| e.data["sourcePath"] == "line.ask")
        .unwrap()
        .id;
    let pier = &rows
        .iter()
        .find(|e| e.data["sourceId"] == "pier" && e.data["sourcePath"] == "title")
        .unwrap()
        .id;
    let ids = vec![line.clone(), pier.clone()];
    let key = "sk-localization-test-only";
    db.set_api_key("custom", key).unwrap();
    for (reply, success) in [
        (json!({line:"Wind's up.",pier:"The Pier"}), true),
        (json!({line:"missing second row"}), false),
        (json!({line:key,pier:"untrusted echo"}), false),
    ] {
        let response = json!({"choices":[{"message":{"content":reply.to_string()}}]});
        let (url, capture) = common::server(response.to_string(), false).await;
        db.save_setting(
            "ai.providers",
            &json!({"configs":{"custom":{"baseUrl":url}}}),
        )
        .unwrap();
        let report = ai_translate_localization(
            &db,
            "p",
            &ids,
            "en-US",
            "custom",
            "test-model",
            ReasoningTier::Fast,
        )
        .await
        .unwrap();
        let request = capture.await.unwrap();
        let (header, body) = request.split_once("\r\n\r\n").unwrap();
        assert!(header
            .to_lowercase()
            .contains(&format!("authorization: bearer {key}")));
        let body: Value = serde_json::from_str(body).unwrap();
        assert!(!body.to_string().contains(key));
        let prompt: Value =
            serde_json::from_str(body["messages"][1]["content"].as_str().unwrap()).unwrap();
        assert_eq!(
            prompt["project"],
            json!({"pitch":"孤岛寻灯","genres":["叙事冒险"]})
        );
        let entries = prompt["entries"].as_array().unwrap();
        let dialogue = entries.iter().find(|v| v["id"] == *line).unwrap();
        assert_eq!(
            dialogue["speaker"],
            json!({"title":"岑","role":"守灯人","personality":"沉着","speechStyle":"短句，先报风向"})
        );
        assert_eq!(
            entries.iter().find(|v| v["id"] == *pier).unwrap()["entity"]["summary"],
            "潮声盖过了钟声。"
        );
        assert_eq!(report.errors.is_empty(), success);
        assert_eq!(report.translated_count, if success { 2 } else { 0 });
        assert!(!serde_json::to_string(&report).unwrap().contains(key));
        assert_eq!(
            db.get_entity(line).unwrap().data["translations"]["en-US"],
            "Wind's up."
        );
        assert!(!serde_json::to_string(&db.export_project("p").unwrap())
            .unwrap()
            .contains(key));
        assert!(db.list_ai_messages("p").unwrap().is_empty());
    }
}

#[test]
fn quantity_rolls_and_branch_export_match_playtest() {
    let table: Vec<QuantityDropEntry> = serde_json::from_value(
        json!([{"id":"oil","weight":1,"unitValue":3,"minQty":2,"maxQty":4}]),
    )
    .unwrap();
    let sim = simulate_quantity_drop_table(&table, 10000, 42).unwrap();
    assert_eq!(sim.expected_value, 9.);
    assert_eq!(sim.total_value, sim.entries[0].total_quantity as f64 * 3.);
    assert!((sim.simulated_value - 9.).abs() < 0.1);
    assert_eq!(
        sim.total_value,
        simulate_quantity_drop_table(&table, 10000, 42)
            .unwrap()
            .total_value
    );
    let (dir, db) = workspace();
    db.save_entity(&entity("scene","Dock",json!({"lines":[{"id":"a","choices":[{"text":"靠岸","condition":"好感度 >= 2","setVar":"信任老秦 = true","nextLineId":"__END__"}]},{"id":"b","condition":"!信任老秦","text":"再见"}]}))).unwrap();
    let out = dir.path().join("game");
    sync_project_to_engine(
        &db,
        "p",
        &EngineConfig {
            target_dir: out.clone(),
            ..Default::default()
        },
    )
    .unwrap();
    let yarn = fs::read_to_string(out.join("dialogue.yarn")).unwrap();
    assert!(yarn.contains("-> 靠岸 <<if $") && yarn.contains(" >= 2>>\n    <<set $"));
    let variable = yarn
        .split("<<set ")
        .nth(1)
        .unwrap()
        .split(" = true>>\n    <<stop>>")
        .next()
        .unwrap();
    assert!(yarn.contains(&format!("<<if not {variable}>>")));
}

#[tokio::test]
async fn translation_merges_other_languages_and_keeps_a_concurrent_manual_edit() {
    let (dir, db) = workspace();
    upsert_localization(
        &db,
        "p",
        &["a", "b", "c"].map(|key| LocaleEntry {
            key: key.into(),
            source: Some(key.into()),
            translations: if key == "c" {
                BTreeMap::from([("en-US".into(), "Existing".into())])
            } else {
                BTreeMap::new()
            },
        }),
    )
    .unwrap();
    let rows = db
        .entity_page("p", Some("locale_entry"), None, None, 10, 0)
        .unwrap();
    let (a, b) = (rows[0].id.clone(), rows[1].id.clone());
    let reply = json!({a.clone():"AI A",b.clone():"AI B"});
    let response = json!({"choices":[{"message":{"content":reply.to_string()}}]});
    let other = Database::open(&dir.path().join("source")).unwrap();
    let (first, second) = (a.clone(), b.clone());
    let (url, capture) = common::server_with(response.to_string(), false, move || {
        save_locale_translation(&other, "p", &first, "en-US", "Manual A").unwrap();
        save_locale_translation(&other, "p", &second, "ja-JP", "手訳").unwrap();
    })
    .await;
    db.save_setting(
        "ai.providers",
        &json!({"configs":{"ollama":{"baseUrl":url}}}),
    )
    .unwrap();
    let r = ai_translate_localization(
        &db,
        "p",
        &[],
        "en-US",
        "ollama",
        "test",
        ai::ReasoningTier::Standard,
    )
    .await
    .unwrap();
    assert_eq!((r.translated_count, r.skipped_count), (1, 2));
    assert!(r.errors.is_empty());
    assert_eq!(
        db.get_entity(&a).unwrap().data["translations"]["en-US"],
        "Manual A"
    );
    assert_eq!(
        db.get_entity(&b).unwrap().data["translations"],
        json!({"en-US":"AI B","ja-JP":"手訳"})
    );
    capture.await.unwrap();
}

fn proposal(db: &Database, op: Value, mode: &str) -> AiProposal {
    db.proposal_batch("p", &[op], mode, None).unwrap().remove(0)
}

#[test]
fn ai_map_formats_edits_conflicts_and_exact_rollback() {
    let (_dir, db) = workspace();
    let create = proposal(
        &db,
        json!({"operation":"create_map","name":"海岸","width":3,"height":2,
        "layers":[{"grid":[[1,2],[5]]},{"cells":[{"x":2,"y":1,"tileId":19}]},{"tiles":[7,6,5,4,3,2,1]},{"rows":[[4,3,2,99]]}],
        "pins":[{"x":1,"y":1,"label":"村口"}],"customTiles":[{"id":20,"name":"冰","color":"#eee"}]}),
        "review",
    );
    assert_eq!(create.entity_type, "map");
    assert_eq!(create.before, json!({}));
    assert!(db.list_maps("p").unwrap().is_empty());
    let id = create.target_entity_id.as_deref().unwrap();
    db.apply_ai_proposal(&create.id).unwrap();
    let original = db.get_map(id).unwrap();
    assert_eq!(json!(original), create.after);
    assert_eq!(original.tile_size, 32);
    assert_eq!(original.layers[0]["tiles"], json!([1, 2, 0, 5, 0, 0]));
    assert_eq!(original.layers[1]["tiles"], json!([0, 0, 0, 0, 0, 19]));
    assert_eq!(original.layers[2]["tiles"], json!([7, 6, 5, 4, 3, 2]));
    assert_eq!(original.layers[3]["tiles"], json!([4, 3, 2, 0, 0, 0]));
    assert_eq!(original.pins[0]["color"], "#ad5946");
    assert_eq!(original.pins[0]["entityId"], "");
    assert!(uuid::Uuid::parse_str(original.pins[0]["id"].as_str().unwrap()).is_ok());
    assert!(db
        .list_activity("p")
        .unwrap()
        .iter()
        .any(|l| l.action == "create_map" && l.summary == "AI 创建了地图 海岸"));
    let edit = json!({"operation":"update_map","mapId":id,"width":2,"tileEdits":[{"layerIndex":0,"x":1,"y":1,"tileId":8}],
        "pinUpserts":[{"x":1,"y":1,"label":"新村口"},{"x":0,"y":0,"label":"起点"}]});
    let update = proposal(&db, edit.clone(), "review");
    let delete = json!({"operation":"delete_map","targetMapId":id});
    let stale = proposal(&db, delete.clone(), "review");
    db.apply_ai_proposal(&update.id).unwrap();
    assert!(db.apply_ai_proposal(&stale.id).is_err());
    assert!(db.rollback_ai_proposal(&create.id).is_err());
    let edited = db.get_map(id).unwrap();
    assert_eq!(edited.layers[0]["tiles"], json!([1, 2, 5, 8]));
    assert_eq!(edited.pins[0]["id"], original.pins[0]["id"]);
    assert_eq!(edited.pins[0]["label"], "新村口");
    assert_eq!(edited.pins.as_array().unwrap().len(), 2);
    let deleted = proposal(&db, delete.clone(), "apply");
    assert!(db.get_map(id).is_err());
    db.rollback_ai_proposal(&deleted.id).unwrap();
    assert_eq!(db.get_map(id).unwrap(), edited);
    db.rollback_ai_proposal(&update.id).unwrap();
    assert_eq!(db.get_map(id).unwrap(), original);
    let seq = db.last_change().unwrap();
    let dry = db
        .proposal_batch("p", &[edit.clone(), delete], "dry_run", None)
        .unwrap();
    assert_eq!(dry[1].before["width"], 2);
    assert_eq!(db.last_change().unwrap(), seq);
    for bad in [
        json!({"width":129}),
        json!({"height":0}),
        json!({"tileSize":2}),
        json!({"pinUpserts":[{"x":4,"y":0}]}),
        json!({"tileEdits":[{"x":1,"y":0,"layerIndex":9,"tileId":1}]}),
    ] {
        let mut broken = edit.clone();
        broken
            .as_object_mut()
            .unwrap()
            .extend(bad.as_object().unwrap().clone());
        assert!(db
            .proposal_batch("p", &[edit.clone(), broken], "apply", None)
            .is_err());
        assert_eq!(db.get_map(id).unwrap(), original);
    }
    db.rollback_ai_proposal(&create.id).unwrap();
    assert!(db.list_maps("p").unwrap().is_empty());
}

#[test]
fn ai_recipes_and_links_validate_references_and_restore_snapshots() {
    let (_dir, db) = workspace();
    for id in ["axe", "wood", "bench"] {
        db.save_entity(&entity("item", id, json!({}))).unwrap();
    }
    let create = proposal(
        &db,
        json!({"operation":"upsert_recipe","outputItemId":"axe","ingredients":[{"itemId":"wood","qty":2}],"tools":["bench"]}),
        "review",
    );
    assert_eq!(create.summary, "合成：axe");
    db.soft_delete("wood").unwrap();
    assert!(db.apply_ai_proposal(&create.id).is_err());
    db.restore("wood").unwrap();
    db.apply_ai_proposal(&create.id).unwrap();
    let id = create.target_entity_id.as_deref().unwrap();
    let original = db.get_recipe(id).unwrap();
    assert_eq!(original.output_qty, 1);
    let update = proposal(
        &db,
        json!({"operation":"upsert_recipe","id":id,"outputItemId":"axe","outputQty":3,"note":"批次"}),
        "apply",
    );
    let edited = db.get_recipe(id).unwrap();
    assert_eq!(edited.ingredients, original.ingredients);
    assert_eq!(edited.output_qty, 3);
    assert!(db.rollback_ai_proposal(&create.id).is_err());
    let deleted = proposal(
        &db,
        json!({"operation":"delete_recipe","recipeId":id}),
        "apply",
    );
    assert!(db.get_recipe(id).is_err());
    db.rollback_ai_proposal(&deleted.id).unwrap();
    assert_eq!(db.get_recipe(id).unwrap(), edited);
    db.rollback_ai_proposal(&update.id).unwrap();
    assert_eq!(db.get_recipe(id).unwrap(), original);
    db.rollback_ai_proposal(&create.id).unwrap();
    assert!(db.list_recipes("p").unwrap().is_empty());
    let link = proposal(
        &db,
        json!({"operation":"create_link","sourceId":"axe","targetId":"wood","relationLabel":"材料"}),
        "apply",
    );
    let link_id = link.target_entity_id.as_deref().unwrap();
    let original = db.get_link(link_id).unwrap();
    let remove = proposal(
        &db,
        json!({"operation":"delete_link","targetEntityId":link_id}),
        "review",
    );
    assert_eq!(remove.before, json!(original));
    assert_eq!(remove.after, json!({}));
    let mut changed = original.clone();
    changed.relation_label = "新关联".into();
    db.save_link(&changed).unwrap();
    assert!(db.apply_ai_proposal(&remove.id).is_err());
    db.save_link(&original).unwrap();
    db.apply_ai_proposal(&remove.id).unwrap();
    assert!(db.get_link(link_id).is_err());
    db.soft_delete("axe").unwrap();
    assert!(db.rollback_ai_proposal(&remove.id).is_err());
    db.restore("axe").unwrap();
    db.rollback_ai_proposal(&remove.id).unwrap();
    assert_eq!(db.get_link(link_id).unwrap(), original);
}
#[test]
fn ai_rejects_read_only_and_invented_entity_types() {
    let (_dir, db) = workspace();
    db.save_entity(&entity("calendar_event", "event", json!({})))
        .unwrap();
    for op in [
        json!({"operation":"create_entity","entityType":"calendar_event","title":"日期"}),
        json!({"operation":"update_entity","targetEntityId":"event","patch":{"title":"新日期"}}),
        json!({"operation":"delete_entity","targetEntityId":"event"}),
    ] {
        assert!(db
            .proposal_batch("p", &[op], "review", None)
            .unwrap_err()
            .to_string()
            .contains("日历模块当前不支持 AI 写入"));
    }
    for kind in ["map", "time_entries", "", "bogus"] {
        assert!(db
            .proposal_batch(
                "p",
                &[json!({"operation":"create_entity","entityType":kind,"title":"测试"})],
                "apply",
                None
            )
            .is_err());
    }
    assert!(db.list_ai_proposals("p").unwrap().is_empty());
}

async fn chat_request(
    db: &Database,
    module: &str,
    scope: Option<&str>,
    focus: Option<&str>,
    mode: &str,
    reply: Value,
) -> (AiMessage, Value, String, Value) {
    let (url, capture) = common::server(
        json!({"choices":[{"message":{"content":reply.to_string()}}]}).to_string(),
        false,
    )
    .await;
    let mut config = ai::providers()
        .into_iter()
        .find(|c| c.id == "openai")
        .unwrap();
    config.requires_key = false;
    config.base_url = url;
    let mut request = json!({"projectId":"p","module":module,"focusedId":focus,"prompt":"帮我设计一个","mode":mode,"config":config});
    if let Some(scope) = scope {
        request["scope"] = json!(scope);
    }
    let request: ai::ChatRequest = serde_json::from_value(request).unwrap();
    let result = db.ai_chat_send(&request, |_| {}).await.unwrap();
    let capture = capture.await.unwrap();
    let body: Value = serde_json::from_str(capture.split_once("\r\n\r\n").unwrap().1).unwrap();
    let system = body["messages"][0]["content"].as_str().unwrap().to_owned();
    let context = system
        .split_once("项目资料：")
        .unwrap()
        .1
        .lines()
        .next()
        .unwrap();
    assert!(context.len() < 32 * 1024);
    let context = serde_json::from_str(context).unwrap();
    (result, body, system, context)
}

#[tokio::test]
async fn ai_context_and_provider_contract_follow_locked_module() {
    let (_dir, db) = workspace();
    let mut scene = entity("scene", "opening", json!({"lines":[]}));
    scene.body = "雪".repeat(20000);
    db.save_entity(&scene).unwrap();
    let map=db.create_map("p",&json!({"name":"码头","width":3,"height":2,"layers":[{"name":"水面","grid":[[5]]}],"pins":[{"x":1,"y":1,"label":"泊位"}],"customTiles":[{"id":20,"name":"冰"}]})).unwrap();
    let noop = json!({"reply":"完成","operations":[]});
    let (_, _, system, ctx) =
        chat_request(&db, "scenes", None, Some("opening"), "review", noop.clone()).await;
    assert!(system.contains("【场景对白】"));
    assert_eq!(ctx["activeModule"]["scope"], "module");
    assert!(ctx["activeModule"]["schema"]["scene"]["lines"]
        .as_str()
        .unwrap()
        .contains("setVar"));
    assert_eq!(ctx["moduleItems"]["entities"][0]["id"], "opening");
    let operation = json!({"operation":"create_map","name":"山道","width":2,"height":2});
    let reply = json!({"reply":"地图待审核","operations":[operation]});
    let (message, body, _, ctx) = chat_request(
        &db,
        "mapmaker",
        None,
        Some(&map.id),
        "review",
        reply.clone(),
    )
    .await;
    let active = &ctx["activeModule"];
    assert_eq!(active["mapTerrains"]["19"], "浅草/装饰");
    assert_eq!(active["mapIcons"].as_array().unwrap().len(), 16);
    assert_eq!(ctx["moduleItems"]["maps"][0]["id"], map.id);
    assert_eq!(ctx["focus"]["layers"][0]["name"], "水面");
    assert_eq!(ctx["focus"]["pins"][0]["label"], "泊位");
    assert_eq!(ctx["focus"]["customTiles"][0]["id"], 20);
    let ops = body
        .pointer(
            "/tools/0/function/parameters/properties/operations/items/properties/operation/enum",
        )
        .unwrap()
        .as_array()
        .unwrap();
    assert_eq!(ops.len(), 10);
    let proposed = message.proposals[0].as_str().unwrap();
    assert_eq!(db.list_maps("p").unwrap().len(), 1);
    db.apply_ai_proposal(proposed).unwrap();
    assert_eq!(db.list_maps("p").unwrap().len(), 2);
    db.save_entity(&entity("item", "coin", json!({}))).unwrap();
    proposal(
        &db,
        json!({"operation":"upsert_recipe","outputItemId":"coin"}),
        "apply",
    );
    let (_, _, _, ctx) = chat_request(&db, "inventory", None, None, "ask", noop.clone()).await;
    assert_eq!(ctx["moduleItems"]["recipes"][0]["outputItemId"], "coin");
    assert_eq!(ctx["moduleItems"]["entities"][0]["id"], "coin");
    proposal(
        &db,
        json!({"operation":"create_link","sourceId":"opening","targetId":"coin","relationLabel":"奖励"}),
        "apply",
    );
    let (_, _, _, ctx) = chat_request(&db, "graph", None, None, "ask", noop.clone()).await;
    assert_eq!(ctx["moduleItems"]["links"][0]["sourceId"], "opening");
    let count = db.list_ai_proposals("p").unwrap().len();
    for (module, mode) in [("calendar", "review"), ("time", "auto")] {
        let (message, body, system, ctx) =
            chat_request(&db, module, None, None, mode, reply.clone()).await;
        assert_eq!(ctx["activeModule"]["readOnly"], true);
        assert_eq!(body["stream"], true);
        assert!(body.get("tools").is_none());
        assert!(!system.contains("只返回一个 JSON 对象"));
        assert_eq!(message.proposals, json!([]));
    }
    assert_eq!(db.list_ai_proposals("p").unwrap().len(), count);
    for (module, scope) in [("overview", None), ("calendar", Some("project"))] {
        let (message, _, system, ctx) =
            chat_request(&db, module, scope, None, "review", reply.clone()).await;
        assert_eq!(ctx["activeModule"]["scope"], "project");
        assert!(system.contains("全项目范围"));
        assert_eq!(message.proposals.as_array().unwrap().len(), 1);
    }
}

#[test]
fn reviewed_recipes_use_project_ids_and_accept_batches_atomically() {
    let (_dir, db) = workspace();
    db.save_project(&Project {
        id: "other".into(),
        name: "Other".into(),
        ..Default::default()
    })
    .unwrap();
    db.save_entity(&Entity {
        project_id: "other".into(),
        ..entity("item", "foreign", json!({}))
    })
    .unwrap();
    db.save_entity(&entity("item", "local", json!({}))).unwrap();
    db.save_entity(&entity("task", "task", json!({}))).unwrap();
    let op = json!({"operation":"upsert_recipe","outputItemId":"local"});
    for invalid in [
        json!({"outputItemId":"task"}),
        json!({"outputItemId":"foreign"}),
        json!({"ingredients":[{"itemId":"foreign","qty":1}]}),
        json!({"ingredients":[{"itemId":"local","qty":0}]}),
        json!({"tools":["task"]}),
        json!({"outputQty":0}),
    ] {
        let mut bad = op.clone();
        bad.as_object_mut()
            .unwrap()
            .extend(invalid.as_object().unwrap().clone());
        assert!(db.proposal_batch("p", &[bad], "review", None).is_err());
    }
    let legacy = CraftingRecipe {
        id: "legacy".into(),
        project_id: "p".into(),
        output_item_id: "local".into(),
        output_qty: 1,
        ingredients: json!([{"itemId":"local","quantity":2}]),
        tools: json!([]),
        ..Default::default()
    };
    db.save_recipe(&legacy).unwrap();
    let old = db.get_recipe("legacy").unwrap();
    let ops = [
        json!({"operation":"upsert_recipe","id":"legacy","outputItemId":"local","note":"revised"}),
        json!({"operation":"delete_recipe","targetRecipeId":"legacy"}),
    ];
    let rows = db.proposal_batch("p", &ops, "review", None).unwrap();
    let ids: Vec<_> = rows.iter().map(|p| p.id.clone()).collect();
    assert_eq!(rows[1].before["note"], "revised");
    assert_eq!(db.get_recipe("legacy").unwrap(), old);
    db.review_ai_proposals(&ids, true).unwrap();
    assert!(db.get_recipe("legacy").is_err());
    for id in ids.iter().rev() {
        db.rollback_ai_proposal(id).unwrap();
    }
    assert_eq!(db.get_recipe("legacy").unwrap(), old);
}

#[test]
fn ai_cannot_report_deleting_a_link_that_mention_sync_would_recreate() {
    let (_dir, db) = workspace();
    db.save_entity(&entity("item", "coin", json!({}))).unwrap();
    db.save_entity(&Entity {
        body: "获得 [[coin]]".into(),
        ..entity("doc", "reward", json!({}))
    })
    .unwrap();
    let original = db.list_links("p").unwrap().pop().unwrap();
    assert_eq!(original.link_kind, "mention");
    let op = json!({"operation":"delete_link","targetLinkId":original.id});
    assert!(db
        .proposal_batch("p", &[op], "apply", None)
        .unwrap_err()
        .to_string()
        .contains("引用"));
    assert_eq!(db.list_links("p").unwrap(), vec![original]);
    let edit = proposal(
        &db,
        json!({"operation":"update_entity","targetEntityId":"reward","patch":{"body":"获得 coin"}}),
        "apply",
    );
    assert!(db.list_links("p").unwrap().is_empty());
    db.rollback_ai_proposal(&edit.id).unwrap();
    assert_eq!(db.list_links("p").unwrap()[0].target_id, "coin");
}
