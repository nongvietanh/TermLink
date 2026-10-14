//! Settings persistence.

use rusqlite::{params, OptionalExtension};

use super::{now_ms, Db};
use crate::domain::settings::AppSettings;
use crate::error::AppResult;

const APP_KEY: &str = "app";

pub fn load(db: &Db) -> AppResult<AppSettings> {
    let raw: Option<String> = db
        .conn()
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [APP_KEY],
            |r| r.get(0),
        )
        .optional()?;
    Ok(match raw {
        // Fields missing from older documents take their defaults. A corrupt
        // document falls back to defaults instead of preventing startup.
        Some(json) => serde_json::from_str::<AppSettings>(&json)
            .ok()
            .and_then(|s| s.validate().ok())
            .unwrap_or_else(|| {
                log::warn!("stored settings were invalid; using defaults");
                AppSettings::default()
            }),
        None => AppSettings::default(),
    })
}

pub fn save(db: &Db, settings: AppSettings) -> AppResult<AppSettings> {
    let settings = settings.validate()?;
    db.conn().execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![APP_KEY, serde_json::to_string(&settings)?, now_ms()],
    )?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_and_load() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(load(&db).unwrap(), AppSettings::default());
        let mut s = AppSettings::default();
        s.terminal.font_size = 16;
        save(&db, s.clone()).unwrap();
        assert_eq!(load(&db).unwrap(), s);
    }

    #[test]
    fn invalid_stored_document_falls_back_to_defaults() {
        let db = Db::open_in_memory().unwrap();
        db.conn()
            .execute(
                "INSERT INTO settings (key, value, updated_at) VALUES ('app', '{not json', 0)",
                [],
            )
            .unwrap();
        assert_eq!(load(&db).unwrap(), AppSettings::default());
    }

    #[test]
    fn save_rejects_invalid() {
        let db = Db::open_in_memory().unwrap();
        let mut s = AppSettings::default();
        s.terminal.font_size = 1;
        assert!(save(&db, s).is_err());
    }
}
