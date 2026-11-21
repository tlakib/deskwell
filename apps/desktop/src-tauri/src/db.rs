//! SQLite storage with versioned migrations. All queries are parameterised.
//! Large audio files live on disk in `<app data>/audio`; only metadata is stored here.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("database error: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("invalid data: {0}")]
    Invalid(String),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, DbError>;

/// Ordered list of migrations. Never edit an applied migration; append a new one.
pub const MIGRATIONS: &[(i64, &str)] = &[
    (
        1,
        r#"
        CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE reminders (
            id TEXT PRIMARY KEY, data TEXT NOT NULL, enabled INTEGER NOT NULL, category TEXT NOT NULL,
            updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_reminders_enabled ON reminders(enabled);
        CREATE TABLE message_templates (
            id TEXT PRIMARY KEY, category TEXT NOT NULL, language TEXT NOT NULL, data TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE reminder_occurrences (
            id TEXT PRIMARY KEY, reminder_id TEXT NOT NULL, scheduled_at TEXT NOT NULL, delivered_at TEXT NOT NULL,
            time_zone TEXT NOT NULL, result TEXT NOT NULL
        );
        CREATE INDEX idx_occ_reminder ON reminder_occurrences(reminder_id);
        CREATE INDEX idx_occ_delivered ON reminder_occurrences(delivered_at);
        CREATE TABLE reminder_events (
            id TEXT PRIMARY KEY, occurrence_id TEXT NOT NULL, reminder_id TEXT NOT NULL, category TEXT NOT NULL,
            action TEXT NOT NULL, scheduled_at TEXT NOT NULL, at TEXT NOT NULL, time_zone TEXT NOT NULL, detail TEXT,
            UNIQUE(occurrence_id, action)
        );
        CREATE INDEX idx_events_reminder ON reminder_events(reminder_id);
        CREATE TABLE water_entries (id TEXT PRIMARY KEY, ml INTEGER NOT NULL, at TEXT NOT NULL, time_zone TEXT NOT NULL);
        CREATE INDEX idx_water_at ON water_entries(at);
        CREATE TABLE focus_sessions (id TEXT PRIMARY KEY, kind TEXT NOT NULL, started_at TEXT NOT NULL, ends_at TEXT NOT NULL, ended_at TEXT);
        CREATE TABLE voice_assets (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
            duration_sec REAL, file_name TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE sync_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        "#,
    ),
    (
        2,
        r#"
        CREATE INDEX idx_events_at ON reminder_events(at);
        CREATE TABLE daily_summaries (date TEXT PRIMARY KEY, data TEXT NOT NULL, computed_at TEXT NOT NULL);
        "#,
    ),
];

pub struct Db {
    pub conn: Connection,
}

fn now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        let mut db = Db { conn };
        db.migrate(None)?;
        Ok(db)
    }

    pub fn schema_version(&self) -> Result<i64> {
        Ok(self.conn.query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))?)
    }

    /// Apply pending migrations (optionally only up to `target`) inside one transaction each.
    pub fn migrate(&mut self, target: Option<i64>) -> Result<()> {
        self.conn.execute_batch("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);")?;
        let current = self.schema_version()?;
        for (v, sql) in MIGRATIONS {
            if *v <= current || target.map(|t| *v > t).unwrap_or(false) {
                continue;
            }
            let tx = self.conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.execute("INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)", params![v, now()])?;
            tx.commit()?;
        }
        Ok(())
    }

    // ----- key/value -----
    pub fn get_json(&self, key: &str) -> Result<Option<Value>> {
        let v: Option<String> = self.conn.query_row("SELECT value FROM app_settings WHERE key = ?1", [key], |r| r.get(0)).optional()?;
        Ok(match v {
            Some(s) => Some(serde_json::from_str(&s)?),
            None => None,
        })
    }

    pub fn set_json(&self, key: &str, value: &Value) -> Result<()> {
        self.conn.execute(
            "INSERT INTO app_settings(key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, serde_json::to_string(value)?, now()],
        )?;
        Ok(())
    }

    // ----- reminders -----
    pub fn list_reminders(&self) -> Result<Vec<Value>> {
        let mut st = self.conn.prepare("SELECT data FROM reminders ORDER BY sort, rowid")?;
        let rows = st.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|s| Ok(serde_json::from_str(&s?)?)).collect()
    }

    pub fn upsert_reminder(&self, v: &Value) -> Result<()> {
        let r: crate::model::Reminder = serde_json::from_value(v.clone()).map_err(|e| DbError::Invalid(e.to_string()))?;
        if r.name.trim().is_empty() || r.name.chars().count() > 80 {
            return Err(DbError::Invalid("reminder name must be 1-80 characters".into()));
        }
        self.conn.execute(
            "INSERT INTO reminders(id, data, enabled, category, updated_at, revision) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET data = excluded.data, enabled = excluded.enabled, category = excluded.category,
             updated_at = excluded.updated_at, revision = excluded.revision",
            params![r.id, serde_json::to_string(v)?, r.enabled as i64, r.category, r.updated_at, r.revision as i64],
        )?;
        Ok(())
    }

    pub fn delete_reminder(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM reminders WHERE id = ?1", [id])?;
        Ok(())
    }

    // ----- templates -----
    pub fn list_templates(&self) -> Result<Vec<Value>> {
        let mut st = self.conn.prepare("SELECT data FROM message_templates ORDER BY sort, rowid")?;
        let rows = st.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|s| Ok(serde_json::from_str(&s?)?)).collect()
    }

    pub fn upsert_template(&self, v: &Value) -> Result<()> {
        let id = v["id"].as_str().ok_or_else(|| DbError::Invalid("template id".into()))?;
        let text = v["text"].as_str().unwrap_or("");
        if text.trim().is_empty() || text.chars().count() > 500 {
            return Err(DbError::Invalid("template text must be 1-500 characters".into()));
        }
        self.conn.execute(
            "INSERT INTO message_templates(id, category, language, data, sort) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET category = excluded.category, language = excluded.language, data = excluded.data, sort = excluded.sort",
            params![id, v["category"].as_str().unwrap_or("custom"), v["language"].as_str().unwrap_or("en"), serde_json::to_string(v)?, v["order"].as_i64().unwrap_or(0)],
        )?;
        Ok(())
    }

    pub fn delete_template(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM message_templates WHERE id = ?1", [id])?;
        Ok(())
    }

    // ----- occurrences & events -----
    /// Returns true if this occurrence was newly recorded (i.e. it has not been delivered before).
    pub fn record_occurrence(&self, id: &str, reminder_id: &str, scheduled_at: &str, tz: &str, result: &str) -> Result<bool> {
        let n = self.conn.execute(
            "INSERT OR IGNORE INTO reminder_occurrences(id, reminder_id, scheduled_at, delivered_at, time_zone, result) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, reminder_id, scheduled_at, now(), tz, result],
        )?;
        Ok(n == 1)
    }

    pub fn delivered_since(&self, since_iso: &str) -> Result<std::collections::HashSet<String>> {
        let mut st = self.conn.prepare("SELECT id FROM reminder_occurrences WHERE delivered_at >= ?1 OR scheduled_at >= ?1")?;
        let rows = st.query_map([since_iso], |r| r.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn add_event(&self, e: &Value) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO reminder_events(id, occurrence_id, reminder_id, category, action, scheduled_at, at, time_zone, detail)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                e["id"].as_str().unwrap_or_default(),
                e["occurrenceId"].as_str().unwrap_or_default(),
                e["reminderId"].as_str().unwrap_or_default(),
                e["category"].as_str().unwrap_or("custom"),
                e["action"].as_str().unwrap_or_default(),
                e["scheduledAt"].as_str().unwrap_or_default(),
                e["at"].as_str().unwrap_or_default(),
                e["timeZone"].as_str().unwrap_or("UTC"),
                e["detail"].as_str(),
            ],
        )?;
        Ok(())
    }

    pub fn list_events(&self, from: &str, to: &str) -> Result<Vec<Value>> {
        let mut st = self.conn.prepare(
            "SELECT id, occurrence_id, reminder_id, category, action, scheduled_at, at, time_zone, detail FROM reminder_events WHERE at >= ?1 AND at < ?2 ORDER BY at",
        )?;
        let rows = st.query_map([from, to], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?, "occurrenceId": r.get::<_, String>(1)?, "reminderId": r.get::<_, String>(2)?,
                "category": r.get::<_, String>(3)?, "action": r.get::<_, String>(4)?, "scheduledAt": r.get::<_, String>(5)?,
                "at": r.get::<_, String>(6)?, "timeZone": r.get::<_, String>(7)?, "detail": r.get::<_, Option<String>>(8)?,
            }))
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    // ----- water -----
    pub fn add_water(&self, id: &str, ml: i64, at: &str, tz: &str) -> Result<()> {
        if !(1..=5000).contains(&ml) {
            return Err(DbError::Invalid("water amount must be 1-5000 ml".into()));
        }
        self.conn.execute("INSERT INTO water_entries(id, ml, at, time_zone) VALUES (?1, ?2, ?3, ?4)", params![id, ml, at, tz])?;
        Ok(())
    }

    pub fn undo_water(&self, since: &str) -> Result<bool> {
        let n = self.conn.execute(
            "DELETE FROM water_entries WHERE id = (SELECT id FROM water_entries WHERE at >= ?1 ORDER BY at DESC, rowid DESC LIMIT 1)",
            [since],
        )?;
        Ok(n == 1)
    }

    pub fn list_water(&self, from: &str, to: &str) -> Result<Vec<Value>> {
        let mut st = self.conn.prepare("SELECT id, ml, at, time_zone FROM water_entries WHERE at >= ?1 AND at < ?2 ORDER BY at")?;
        let rows = st.query_map([from, to], |r| {
            Ok(json!({ "id": r.get::<_, String>(0)?, "ml": r.get::<_, i64>(1)?, "at": r.get::<_, String>(2)?, "timeZone": r.get::<_, String>(3)? }))
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    // ----- focus -----
    pub fn start_focus(&self, id: &str, kind: &str, started: &str, ends: &str) -> Result<()> {
        self.conn.execute("UPDATE focus_sessions SET ended_at = ?1 WHERE ended_at IS NULL", [started])?;
        self.conn.execute("INSERT INTO focus_sessions(id, kind, started_at, ends_at) VALUES (?1, ?2, ?3, ?4)", params![id, kind, started, ends])?;
        Ok(())
    }

    pub fn end_focus(&self, at: &str) -> Result<()> {
        self.conn.execute("UPDATE focus_sessions SET ended_at = MIN(ends_at, ?1) WHERE ended_at IS NULL", [at])?;
        Ok(())
    }

    pub fn list_focus(&self, from: &str, to: &str) -> Result<Vec<Value>> {
        let mut st = self.conn.prepare("SELECT id, kind, started_at, ends_at, ended_at FROM focus_sessions WHERE started_at >= ?1 AND started_at < ?2 ORDER BY started_at")?;
        let rows = st.query_map([from, to], |r| {
            Ok(json!({ "id": r.get::<_, String>(0)?, "kind": r.get::<_, String>(1)?, "startedAt": r.get::<_, String>(2)?, "endsAt": r.get::<_, String>(3)?, "endedAt": r.get::<_, Option<String>>(4)? }))
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    // ----- voice assets -----
    pub fn list_assets(&self) -> Result<Vec<Value>> {
        let mut st = self.conn.prepare("SELECT id, name, category, mime, bytes, duration_sec, created_at FROM voice_assets ORDER BY created_at DESC")?;
        let rows = st.query_map([], |r| {
            Ok(json!({ "id": r.get::<_, String>(0)?, "name": r.get::<_, String>(1)?, "category": r.get::<_, String>(2)?, "mime": r.get::<_, String>(3)?,
                       "bytes": r.get::<_, i64>(4)?, "durationSec": r.get::<_, Option<f64>>(5)?, "createdAt": r.get::<_, String>(6)? }))
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn asset_file(&self, id: &str) -> Result<Option<(String, String)>> {
        Ok(self.conn.query_row("SELECT file_name, mime FROM voice_assets WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?)
    }

    pub fn insert_asset(&self, id: &str, name: &str, category: &str, mime: &str, bytes: i64, file_name: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO voice_assets(id, name, category, mime, bytes, duration_sec, file_name, created_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7)",
            params![id, name, category, mime, bytes, file_name, now()],
        )?;
        Ok(())
    }

    pub fn update_asset(&self, id: &str, name: Option<&str>, category: Option<&str>, duration: Option<f64>) -> Result<()> {
        if let Some(n) = name {
            if n.trim().is_empty() || n.chars().count() > 120 {
                return Err(DbError::Invalid("name must be 1-120 characters".into()));
            }
            self.conn.execute("UPDATE voice_assets SET name = ?1 WHERE id = ?2", params![n, id])?;
        }
        if let Some(c) = category {
            self.conn.execute("UPDATE voice_assets SET category = ?1 WHERE id = ?2", params![c, id])?;
        }
        if let Some(d) = duration {
            self.conn.execute("UPDATE voice_assets SET duration_sec = ?1 WHERE id = ?2", params![d, id])?;
        }
        Ok(())
    }

    /// Reminder ids that reference an audio asset (checked before deletion).
    pub fn asset_references(&self, id: &str) -> Result<Vec<String>> {
        let mut out = vec![];
        for r in self.list_reminders()? {
            if r["voice"]["audioIds"].as_array().map(|a| a.iter().any(|x| x.as_str() == Some(id))).unwrap_or(false) {
                out.push(r["name"].as_str().unwrap_or("?").to_string());
            }
        }
        Ok(out)
    }

    pub fn delete_asset(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM voice_assets WHERE id = ?1", [id])?;
        Ok(())
    }

    // ----- backup -----
    pub fn export_all(&self, with_history: bool) -> Result<Value> {
        let far = "9999-12-31";
        Ok(json!({
            "settings": self.get_json("settings")?,
            "reminders": self.list_reminders()?,
            "templates": self.list_templates()?,
            "history": if with_history { json!({ "events": self.list_events("", far)?, "water": self.list_water("", far)?, "focus": self.list_focus("", far)? }) } else { Value::Null },
        }))
    }

    /// Replace all user data in one transaction. On any error nothing is changed.
    pub fn import_all(&mut self, data: &Value) -> Result<()> {
        // Validate everything before touching the database.
        let reminders = data["reminders"].as_array().ok_or_else(|| DbError::Invalid("reminders missing".into()))?;
        for r in reminders {
            serde_json::from_value::<crate::model::Reminder>(r.clone()).map_err(|e| DbError::Invalid(format!("reminder: {e}")))?;
        }
        let templates = data["templates"].as_array().cloned().unwrap_or_default();
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM reminders", [])?;
        tx.execute("DELETE FROM message_templates", [])?;
        if let Some(s) = data.get("settings").filter(|s| s.is_object()) {
            tx.execute(
                "INSERT INTO app_settings(key, value, updated_at) VALUES ('settings', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                params![serde_json::to_string(s)?, now()],
            )?;
        }
        for (i, r) in reminders.iter().enumerate() {
            let p: crate::model::Reminder = serde_json::from_value(r.clone())?;
            tx.execute(
                "INSERT INTO reminders(id, data, enabled, category, updated_at, revision, sort) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![p.id, serde_json::to_string(r)?, p.enabled as i64, p.category, p.updated_at, p.revision as i64, i as i64],
            )?;
        }
        for t in &templates {
            tx.execute(
                "INSERT OR REPLACE INTO message_templates(id, category, language, data, sort) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![t["id"].as_str().unwrap_or_default(), t["category"].as_str().unwrap_or("custom"), t["language"].as_str().unwrap_or("en"), serde_json::to_string(t)?, t["order"].as_i64().unwrap_or(0)],
            )?;
        }
        if let Some(h) = data.get("history").filter(|h| h.is_object()) {
            for e in h["events"].as_array().cloned().unwrap_or_default() {
                tx.execute(
                    "INSERT OR IGNORE INTO reminder_events(id, occurrence_id, reminder_id, category, action, scheduled_at, at, time_zone, detail) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                    params![e["id"].as_str(), e["occurrenceId"].as_str(), e["reminderId"].as_str(), e["category"].as_str(), e["action"].as_str(), e["scheduledAt"].as_str(), e["at"].as_str(), e["timeZone"].as_str(), e["detail"].as_str()],
                )?;
            }
            for w in h["water"].as_array().cloned().unwrap_or_default() {
                tx.execute("INSERT OR IGNORE INTO water_entries(id, ml, at, time_zone) VALUES (?1, ?2, ?3, ?4)", params![w["id"].as_str(), w["ml"].as_i64(), w["at"].as_str(), w["timeZone"].as_str()])?;
            }
            for f in h["focus"].as_array().cloned().unwrap_or_default() {
                tx.execute(
                    "INSERT OR IGNORE INTO focus_sessions(id, kind, started_at, ends_at, ended_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![f["id"].as_str(), f["kind"].as_str(), f["startedAt"].as_str(), f["endsAt"].as_str(), f["endedAt"].as_str()],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reminder(id: &str) -> Value {
        json!({ "id": id, "name": "Water", "category": "water", "schedule": { "type": "interval", "intervalMinutes": 60 }, "updatedAt": "2026-01-01T00:00:00Z" })
    }

    #[test]
    fn creates_schema_at_latest_version() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.last().unwrap().0);
    }

    #[test]
    fn upgrades_from_v1() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        {
            let conn = Connection::open(&path).unwrap();
            let mut db = Db { conn };
            db.migrate(Some(1)).unwrap();
            assert_eq!(db.schema_version().unwrap(), 1);
            db.upsert_reminder(&reminder("a")).unwrap();
        }
        let db = Db::open(&path).unwrap();
        assert_eq!(db.schema_version().unwrap(), 2);
        assert_eq!(db.list_reminders().unwrap().len(), 1, "data survives the upgrade");
    }

    #[test]
    fn occurrence_is_recorded_once() {
        let db = Db::open_in_memory().unwrap();
        assert!(db.record_occurrence("r@1", "r", "2026", "UTC", "delivered").unwrap());
        assert!(!db.record_occurrence("r@1", "r", "2026", "UTC", "delivered").unwrap());
    }

    #[test]
    fn rejects_invalid_reminder() {
        let db = Db::open_in_memory().unwrap();
        assert!(db.upsert_reminder(&json!({ "id": "x" })).is_err());
        let mut r = reminder("y");
        r["name"] = json!("");
        assert!(db.upsert_reminder(&r).is_err());
    }

    #[test]
    fn import_is_atomic() {
        let mut db = Db::open_in_memory().unwrap();
        db.upsert_reminder(&reminder("keep")).unwrap();
        let bad = json!({ "reminders": [reminder("new"), { "id": "broken" }], "templates": [] });
        assert!(db.import_all(&bad).is_err());
        let ids: Vec<String> = db.list_reminders().unwrap().iter().map(|r| r["id"].as_str().unwrap().to_string()).collect();
        assert_eq!(ids, vec!["keep"], "failed import leaves data untouched");
        let good = json!({ "reminders": [reminder("n1"), reminder("n2")], "templates": [], "history": { "events": [], "water": [{ "id": "w", "ml": 250, "at": "2026-01-01T10:00:00Z", "timeZone": "UTC" }], "focus": [] } });
        db.import_all(&good).unwrap();
        assert_eq!(db.list_reminders().unwrap().len(), 2);
        assert_eq!(db.list_water("", "9999").unwrap().len(), 1);
    }

    #[test]
    fn transaction_rollback_on_error() {
        let mut db = Db::open_in_memory().unwrap();
        {
            let tx = db.conn.transaction().unwrap();
            tx.execute("INSERT INTO water_entries(id, ml, at, time_zone) VALUES ('a', 1, 'x', 'UTC')", []).unwrap();
            // dropped without commit -> rollback
        }
        assert_eq!(db.list_water("", "~").unwrap().len(), 0);
    }

    #[test]
    fn asset_reference_check() {
        let db = Db::open_in_memory().unwrap();
        let mut r = reminder("a");
        r["voice"] = json!({ "mode": "audio", "audioIds": ["snd1"] });
        db.upsert_reminder(&r).unwrap();
        assert_eq!(db.asset_references("snd1").unwrap(), vec!["Water"]);
        assert!(db.asset_references("other").unwrap().is_empty());
    }

    #[test]
    fn water_validation_and_undo() {
        let db = Db::open_in_memory().unwrap();
        assert!(db.add_water("a", 0, "2026-01-01T10:00:00Z", "UTC").is_err());
        db.add_water("a", 250, "2026-01-01T10:00:00Z", "UTC").unwrap();
        db.add_water("b", 500, "2026-01-01T11:00:00Z", "UTC").unwrap();
        assert!(db.undo_water("2026-01-01T00:00:00Z").unwrap());
        let w = db.list_water("", "~").unwrap();
        assert_eq!(w.len(), 1);
        assert_eq!(w[0]["ml"], 250);
    }
}
