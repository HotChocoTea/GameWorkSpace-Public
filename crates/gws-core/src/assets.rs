use crate::{Database, Error, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::PathBuf};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetInfo {
    pub filename: String,
    pub size: usize,
}

pub fn mime_type(filename: &str) -> &'static str {
    match filename.rsplit('.').next().unwrap_or("") {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "webm" => "audio/webm",
        _ => "application/octet-stream",
    }
}
fn valid_extension(ext: &str) -> bool {
    !ext.is_empty()
        && ext.len() <= 10
        && ext
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}
impl Database {
    pub fn save_asset(&self, bytes: &[u8], ext: &str) -> Result<AssetInfo> {
        self.write(|c|{
        let info = self.store_asset(bytes, ext)?;
        // A retry also registers bytes left by an interruption after the atomic rename.
        c.execute(
            "INSERT INTO change_log(entity_type,entity_id,action) SELECT 'asset',?1,'save'
             WHERE NOT EXISTS (SELECT 1 FROM change_log WHERE entity_type='asset' AND entity_id=?1 AND action='save')",
            [&info.filename],
        )?;
        Ok(info)})
    }

    pub(crate) fn store_asset(&self, bytes: &[u8], ext: &str) -> Result<AssetInfo> {
        let ext = ext.to_ascii_lowercase();
        if !valid_extension(&ext) {
            return Err(Error::Invalid("无效的资源扩展名".into()));
        }
        let filename = format!("{:x}.{ext}", Sha256::digest(bytes));
        let path = self.assets.join(&filename);
        if !path.exists() {
            let temp = self.assets.join(uuid::Uuid::new_v4().to_string());
            let write = || -> std::io::Result<()> {
                let mut file = fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&temp)?;
                file.write_all(bytes)?;
                file.sync_all()?;
                drop(file);
                match fs::rename(&temp, &path) {
                    Err(_) if path.is_file() => fs::remove_file(&temp),
                    result => result,
                }
            };
            if let Err(e) = write() {
                let _ = fs::remove_file(temp);
                return Err(e.into());
            }
        }
        Ok(AssetInfo {
            filename,
            size: bytes.len(),
        })
    }

    pub fn resolve_asset_path(&self, filename: &str) -> Result<PathBuf> {
        let (hash, ext) = filename
            .split_once('.')
            .ok_or_else(|| Error::Invalid("无效的资源名".into()))?;
        if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) || !valid_extension(ext)
        {
            return Err(Error::Invalid("无效的资源名".into()));
        }
        let path = self.assets.join(filename);
        if !path.is_file() {
            return Err(Error::Missing);
        }
        Ok(path)
    }
}
