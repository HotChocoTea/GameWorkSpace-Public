use crate::{
    repo::{map_strings, now, save_snapshot},
    Database, Result, Snapshot,
};
use chrono::{Duration, Local};
use serde_json::Value;

const SAMPLE_ART: &[&[u8]] = &[
    include_bytes!("../../../src/assets/lightward/character-1.webp"),
    include_bytes!("../../../src/assets/lightward/character-2.webp"),
    include_bytes!("../../../src/assets/lightward/character-3.webp"),
    include_bytes!("../../../src/assets/lightward/character-4.webp"),
    include_bytes!("../../../src/assets/lightward/character-5.webp"),
    include_bytes!("../../../src/assets/lightward/location-1.webp"),
    include_bytes!("../../../src/assets/lightward/location-2.webp"),
    include_bytes!("../../../src/assets/lightward/location-3.webp"),
    include_bytes!("../../../src/assets/lightward/location-4.webp"),
    include_bytes!("../../../src/assets/lightward/location-5.webp"),
    include_bytes!("../../../src/assets/lightward/vehicle-1.webp"),
    include_bytes!("../../../src/assets/lightward/vehicle-2.webp"),
];

pub fn seed_sample_project_if_empty(db: &Database) -> Result<bool> {
    db.write(|c|{
        let initialized:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM app_settings WHERE key='sample_initialized') OR EXISTS(SELECT 1 FROM projects)",[],|r|r.get(0))?;
        if initialized {return Ok(false)}
        for bytes in SAMPLE_ART { db.store_asset(bytes, "webp")?; }
        let mut sample:Value=serde_json::from_str(include_str!("../../../shared/lightward.json"))?;
        let today=Local::now().date_naive();
        map_strings(&mut sample,&|s|{
            let raw=s.strip_prefix("@day:")?;
            let (offset,suffix)=raw.split_once('T').map_or((raw,String::new()),|(d,t)|(d,format!("T{t}")));
            let date=today.checked_add_signed(Duration::days(offset.parse().ok()?))?;
            Some(format!("{date}{suffix}"))
        });
        let sample:Snapshot=serde_json::from_value(sample)?;
        save_snapshot(c,&sample)?;
        c.execute("INSERT INTO app_settings(key,value_json,updated_at) VALUES('sample_initialized','true',?1)",[now()])?;
        Ok(true)
    })
}
