// The cookie and password live only in the running process.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
};

#[derive(Serialize, Deserialize)]
pub struct Preferences {
    pub address: String,
    pub nickname: String,
    pub ca_file: Option<PathBuf>,
}
impl Preferences {
    fn file() -> Option<PathBuf> {
        Some(
            PathBuf::from(std::env::var_os("LOCALAPPDATA")?)
                .join("ShifrSvyazLite")
                .join("connection.json"),
        )
    }
    pub fn load() -> Option<Self> {
        let mut text = String::new();
        fs::File::open(Self::file()?)
            .ok()?
            .take(32 * 1024)
            .read_to_string(&mut text)
            .ok()?;
        serde_json::from_str(&text).ok()
    }
    pub fn save(&self) -> Option<()> {
        let file = Self::file()?;
        let dir = file.parent()?;
        fs::create_dir_all(dir).ok()?;
        let mut temp = tempfile::NamedTempFile::new_in(dir).ok()?;
        temp.write_all(&serde_json::to_vec(self).ok()?).ok()?;
        temp.persist(file).ok()?;
        Some(())
    }
}
