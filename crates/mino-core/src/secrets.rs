use crate::{Database, Error, Result};
use serde::Serialize;
use std::{collections::BTreeMap, fs, io::Write, path::PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyStatus {
    pub provider_id: String,
    pub configured: bool,
    pub masked: Option<String>,
}

#[cfg(windows)]
fn crypt(bytes: &[u8], protect: bool) -> Result<Vec<u8>> {
    use std::{ptr, slice};
    use windows_sys::Win32::{Foundation::LocalFree, Security::Cryptography::*};
    let input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(bytes.len()).map_err(|_| Error::Invalid("密钥文件过大".into()))?,
        pbData: bytes.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    // DPAPI borrows the input for the call and allocates the output with LocalAlloc.
    unsafe {
        let ok = if protect {
            CryptProtectData(
                &input,
                ptr::null(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                ptr::null_mut(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let result = slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData.cast());
        Ok(result)
    }
}
#[cfg(not(windows))]
fn crypt(_: &[u8], _: bool) -> Result<Vec<u8>> {
    Err(Error::Invalid("密钥存储需要 Windows DPAPI".into()))
}

pub struct SecretStore {
    path: PathBuf,
}
impl SecretStore {
    fn read(&self) -> Result<BTreeMap<String, String>> {
        match fs::read(&self.path) {
            Ok(bytes) => Ok(serde_json::from_slice(&crypt(&bytes, false)?)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(e) => Err(e.into()),
        }
    }
    fn update(&self, provider: &str, key: &str) -> Result<()> {
        let mut keys = self.read()?;
        if key.is_empty() {
            keys.remove(provider);
        } else {
            keys.insert(provider.into(), key.into());
        }
        let bytes = crypt(&serde_json::to_vec(&keys)?, true)?;
        let mut temp =
            tempfile::NamedTempFile::new_in(self.path.parent().expect("data directory"))?;
        temp.write_all(&bytes)?;
        temp.as_file().sync_all()?;
        temp.persist(&self.path).map_err(|e| e.error)?;
        Ok(())
    }
}
impl Database {
    fn secret_store(&self) -> SecretStore {
        SecretStore {
            path: self.assets.with_file_name("secrets.bin"),
        }
    }
    pub fn set_api_key(&self, provider: &str, key: &str) -> Result<()> {
        // Serialize read-modify-replace across workspace processes using the existing writer lock.
        self.write(|_| self.secret_store().update(provider, key.trim()))
    }
    pub fn delete_api_key(&self, provider: &str) -> Result<()> {
        self.set_api_key(provider, "")
    }
    pub(crate) fn get_api_key(&self, provider: &str) -> Result<Option<String>> {
        Ok(self.secret_store().read()?.remove(provider))
    }
    pub fn list_api_key_status(&self) -> Result<Vec<ApiKeyStatus>> {
        let keys = self.secret_store().read()?;
        let mut ids: std::collections::BTreeSet<_> =
            crate::ai::providers().into_iter().map(|p| p.id).collect();
        ids.extend(keys.keys().cloned());
        Ok(ids
            .into_iter()
            .map(|provider_id| {
                let masked = keys.get(&provider_id).map(|key| {
                    let chars: Vec<_> = key.chars().collect();
                    if chars.len() < 10 {
                        "****".into()
                    } else {
                        format!(
                            "{}****{}",
                            if key.starts_with("sk-") { "sk-" } else { "" },
                            chars[chars.len() - 4..].iter().collect::<String>()
                        )
                    }
                });
                ApiKeyStatus {
                    provider_id,
                    configured: masked.is_some(),
                    masked,
                }
            })
            .collect())
    }
}
#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn encrypted_file_reopens_and_deletes() {
        let dir = tempfile::tempdir().unwrap();
        let key = "sk-roundtrip-secret-3f9a";
        let db = Database::open(dir.path()).unwrap();
        db.set_api_key("openai", key).unwrap();
        drop(db);
        let db = Database::open(dir.path()).unwrap();
        assert_eq!(db.get_api_key("openai").unwrap().as_deref(), Some(key));
        assert!(!fs::read(dir.path().join("secrets.bin"))
            .unwrap()
            .windows(key.len())
            .any(|w| w == key.as_bytes()));
        assert_eq!(
            db.list_api_key_status()
                .unwrap()
                .into_iter()
                .find(|s| s.provider_id == "openai")
                .unwrap()
                .masked
                .as_deref(),
            Some("sk-****3f9a")
        );
        db.delete_api_key("openai").unwrap();
        assert!(db.get_api_key("openai").unwrap().is_none());
    }
}
