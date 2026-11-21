//! Tauri commands exposed to the React UI. Every command validates its input on the native side.

use crate::engine::{self, now_ms, system_tz, Shared};
use crate::model::{FocusState, RuntimeState};
use crate::schedule;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;

pub type S<'a> = State<'a, Arc<Shared>>;
type R<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn changed(app: &AppHandle, shared: &Shared) {
    shared.poke();
    let _ = app.emit("deskwell://changed", ());
}

#[tauri::command]
pub fn get_snapshot(shared: S) -> R<Value> {
    let (tz_name, tz) = system_tz();
    let db = shared.db.lock().unwrap();
    let l = engine::load(&db);
    let now = now_ms();
    let delivered = db.delivered_since(&schedule::iso(now - 2 * 86_400_000)).map_err(err)?;
    let plan = engine::compute_plan(&l, tz, &delivered, now);
    let next = plan.map(|p| {
        json!({
            "at": schedule::iso(p.at),
            "items": p.items.iter().map(|i| json!({
                "reminderId": i.reminder_id,
                "occurrenceId": i.occurrence_id,
                "name": l.reminders.iter().find(|r| r.id == i.reminder_id).map(|r| r.name.clone()).unwrap_or_default(),
                "category": l.reminders.iter().find(|r| r.id == i.reminder_id).map(|r| r.category.clone()).unwrap_or_default(),
            })).collect::<Vec<_>>()
        })
    });
    Ok(json!({
        "platform": "desktop",
        "timeZone": tz_name,
        "settings": l.settings_json,
        "reminders": db.list_reminders().map_err(err)?,
        "templates": l.templates,
        "state": l.state,
        "next": next,
        "active": *shared.active.lock().unwrap(),
        "dataDir": shared.data_dir.to_string_lossy(),
    }))
}

#[tauri::command]
pub fn init_defaults(app: AppHandle, shared: S, settings: Value, reminders: Vec<Value>, templates: Vec<Value>) -> R<bool> {
    {
        let db = shared.db.lock().unwrap();
        // A settings record without work profiles is not a real setup (e.g. written by an older build): replace it.
        if db.get_json("settings").map_err(err)?.map(|v| v.get("profiles").is_some()).unwrap_or(false) {
            return Ok(false);
        }
        db.set_json("settings", &settings).map_err(err)?;
        for r in &reminders {
            db.upsert_reminder(r).map_err(err)?;
        }
        for t in &templates {
            db.upsert_template(t).map_err(err)?;
        }
    }
    changed(&app, &shared);
    Ok(true)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, shared: S, settings: Value) -> R<()> {
    if !settings.is_object() {
        return Err("settings must be an object".into());
    }
    serde_json::from_value::<crate::model::ScheduleSettings>(settings.clone()).map_err(err)?;
    shared.db.lock().unwrap().set_json("settings", &settings).map_err(err)?;
    changed(&app, &shared);
    Ok(())
}

#[tauri::command]
pub fn save_reminder(app: AppHandle, shared: S, reminder: Value) -> R<()> {
    shared.db.lock().unwrap().upsert_reminder(&reminder).map_err(err)?;
    changed(&app, &shared);
    Ok(())
}

#[tauri::command]
pub fn delete_reminder(app: AppHandle, shared: S, id: String) -> R<()> {
    shared.db.lock().unwrap().delete_reminder(&id).map_err(err)?;
    changed(&app, &shared);
    Ok(())
}

#[tauri::command]
pub fn save_template(app: AppHandle, shared: S, template: Value) -> R<()> {
    shared.db.lock().unwrap().upsert_template(&template).map_err(err)?;
    changed(&app, &shared);
    Ok(())
}

#[tauri::command]
pub fn delete_template(app: AppHandle, shared: S, id: String) -> R<()> {
    shared.db.lock().unwrap().delete_template(&id).map_err(err)?;
    changed(&app, &shared);
    Ok(())
}

fn update_state(shared: &Shared, f: impl FnOnce(&mut RuntimeState)) -> R<()> {
    let db = shared.db.lock().unwrap();
    let mut st: RuntimeState = db.get_json("state").map_err(err)?.and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
    f(&mut st);
    db.set_json("state", &serde_json::to_value(&st).map_err(err)?).map_err(err)
}

/// `until`: null = resume, "indefinite", or an ISO instant.
#[tauri::command]
pub fn set_pause(app: AppHandle, shared: S, until: Option<String>) -> R<()> {
    pause(&app, &shared, until)
}

pub fn pause(app: &AppHandle, shared: &Shared, until: Option<String>) -> R<()> {
    if let Some(u) = &until {
        if u != "indefinite" && schedule::parse_iso(u).is_none() {
            return Err("invalid pause time".into());
        }
    }
    update_state(shared, |s| s.paused_until = until)?;
    changed(app, shared);
    Ok(())
}

#[tauri::command]
pub fn start_focus(app: AppHandle, shared: S, kind: String, minutes: i64, pause_voice: bool, pause_popup: bool, hold_all: bool) -> R<()> {
    focus(&app, &shared, kind, minutes, pause_voice, pause_popup, hold_all)
}

pub fn focus(app: &AppHandle, shared: &Shared, kind: String, minutes: i64, pause_voice: bool, pause_popup: bool, hold_all: bool) -> R<()> {
    if kind != "focus" && kind != "meeting" {
        return Err("kind must be focus or meeting".into());
    }
    if !(1..=24 * 60).contains(&minutes) {
        return Err("duration must be 1-1440 minutes".into());
    }
    let now = now_ms();
    let started = schedule::iso(now);
    let ends = schedule::iso(now + minutes * 60_000);
    shared.db.lock().unwrap().start_focus(&uuid::Uuid::new_v4().to_string(), &kind, &started, &ends).map_err(err)?;
    update_state(shared, |s| s.focus = Some(FocusState { kind, started_at: started, ends_at: ends, pause_voice, pause_popup, hold_all }))?;
    changed(app, shared);
    Ok(())
}

#[tauri::command]
pub fn stop_focus(app: AppHandle, shared: S) -> R<()> {
    shared.db.lock().unwrap().end_focus(&schedule::iso(now_ms())).map_err(err)?;
    update_state(&shared, |s| s.focus = None)?;
    changed(&app, &shared);
    Ok(())
}

/// Done / snooze / skip / mute for today on a delivered occurrence.
#[tauri::command]
pub fn act(app: AppHandle, shared: S, occurrence_id: String, reminder_id: String, action: String, snooze_minutes: Option<i64>) -> R<()> {
    act_inner(&app, &shared, occurrence_id, reminder_id, action, snooze_minutes)
}

pub fn act_inner(app: &AppHandle, shared: &Shared, occurrence_id: String, reminder_id: String, action: String, snooze_minutes: Option<i64>) -> R<()> {
    let allowed = ["done", "snoozed", "skipped", "muted_today", "dismissed"];
    if !allowed.contains(&action.as_str()) {
        return Err("unknown action".into());
    }
    let (tz_name, tz) = system_tz();
    let now = now_ms();
    let category = {
        let db = shared.db.lock().unwrap();
        let l = engine::load(&db);
        l.reminders.iter().find(|r| r.id == reminder_id).map(|r| r.category.clone()).unwrap_or_else(|| "custom".into())
    };
    let scheduled = shared
        .active
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|a| a.items.iter().find(|d| d.occurrence_id == occurrence_id).map(|d| d.scheduled_at.clone()))
        .unwrap_or_else(|| schedule::iso(now));
    let mut detail: Option<String> = None;
    match action.as_str() {
        "snoozed" => {
            let m = snooze_minutes.unwrap_or(5);
            if !(1..=240).contains(&m) {
                return Err("snooze must be 1-240 minutes".into());
            }
            let until = schedule::iso(now + m * 60_000);
            detail = Some(format!("{m} min"));
            update_state(shared, |s| {
                s.snoozes.insert(reminder_id.clone(), until);
            })?;
        }
        "muted_today" => {
            let today = schedule::date_str(schedule::local_date(now, tz));
            update_state(shared, |s| {
                s.muted_today.insert(reminder_id.clone(), today);
            })?;
        }
        _ => {}
    }
    shared
        .db
        .lock()
        .unwrap()
        .add_event(&json!({
            "id": uuid::Uuid::new_v4().to_string(), "occurrenceId": occurrence_id, "reminderId": reminder_id, "category": category,
            "action": action, "scheduledAt": scheduled, "at": schedule::iso(now), "timeZone": tz_name, "detail": detail,
        }))
        .map_err(err)?;
    let empty = {
        let mut g = shared.active.lock().unwrap();
        if let Some(a) = g.as_mut() {
            a.items.retain(|d| d.occurrence_id != occurrence_id);
        }
        let empty = g.as_ref().map(|a| a.items.is_empty()).unwrap_or(true);
        if empty {
            *g = None;
        }
        empty
    };
    if empty {
        if let Some(w) = app.get_webview_window("popup") {
            let _ = w.hide();
        }
        let _ = app.emit("deskwell://stop-voice", ());
    }
    changed(app, shared);
    Ok(())
}

#[tauri::command]
pub fn dismiss_popup(app: AppHandle, shared: S) -> R<()> {
    *shared.active.lock().unwrap() = None;
    if let Some(w) = app.get_webview_window("popup") {
        let _ = w.hide();
    }
    let _ = app.emit("deskwell://stop-voice", ());
    let _ = app.emit("deskwell://changed", ());
    Ok(())
}

#[tauri::command]
pub fn add_water(app: AppHandle, shared: S, ml: i64) -> R<()> {
    let (tz_name, _) = system_tz();
    shared.db.lock().unwrap().add_water(&uuid::Uuid::new_v4().to_string(), ml, &schedule::iso(now_ms()), &tz_name).map_err(err)?;
    let _ = app.emit("deskwell://changed", ());
    Ok(())
}

#[tauri::command]
pub fn undo_water(app: AppHandle, shared: S) -> R<bool> {
    let (_, tz) = system_tz();
    let start = schedule::start_of_local_day(schedule::local_date(now_ms(), tz), tz);
    let ok = shared.db.lock().unwrap().undo_water(&schedule::iso(start)).map_err(err)?;
    let _ = app.emit("deskwell://changed", ());
    Ok(ok)
}

#[tauri::command]
pub fn list_history(shared: S, from: String, to: String) -> R<Value> {
    let db = shared.db.lock().unwrap();
    Ok(json!({
        "events": db.list_events(&from, &to).map_err(err)?,
        "water": db.list_water(&from, &to).map_err(err)?,
        "focus": db.list_focus(&from, &to).map_err(err)?,
    }))
}

// ----- audio library -----

const MAX_AUDIO: usize = 15 * 1024 * 1024;

fn sniff(head: &[u8]) -> Option<(&'static str, &'static str)> {
    let at = |o: usize, s: &[u8]| head.len() >= o + s.len() && &head[o..o + s.len()] == s;
    if at(0, b"ID3") || (head.len() > 1 && head[0] == 0xff && (head[1] & 0xe0) == 0xe0 && (head[1] & 0x06) != 0) {
        return Some(("audio/mpeg", "mp3"));
    }
    if head.len() > 1 && head[0] == 0xff && (head[1] & 0xf6) == 0xf0 {
        return Some(("audio/aac", "aac"));
    }
    if at(0, b"RIFF") && at(8, b"WAVE") {
        return Some(("audio/wav", "wav"));
    }
    if at(0, b"OggS") {
        return Some(("audio/ogg", "ogg"));
    }
    if at(4, b"ftyp") {
        return Some(("audio/mp4", "m4a"));
    }
    if at(0, &[0x1a, 0x45, 0xdf, 0xa3]) {
        return Some(("audio/webm", "webm"));
    }
    None
}

fn header(req: &Request, name: &str) -> String {
    req.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| percent_decode(s))
        .unwrap_or_default()
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Raw body = audio bytes. Headers: x-name, x-category, optional x-id (restore from backup).
#[tauri::command]
pub fn import_audio(app: AppHandle, shared: S, request: Request<'_>) -> R<Value> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw audio bytes".into()) };
    if bytes.is_empty() || bytes.len() > MAX_AUDIO {
        return Err("Audio files must be between 1 byte and 15 MB.".into());
    }
    let (mime, ext) = sniff(&bytes[..bytes.len().min(16)]).ok_or("This file is not a supported audio format (mp3, wav, ogg, m4a, aac, webm).")?;
    let mut name = header(&request, "x-name");
    name = name.trim().chars().take(120).collect();
    if name.is_empty() {
        name = "Recording".into();
    }
    let category = header(&request, "x-category");
    let requested_id = header(&request, "x-id");
    let id = if requested_id.len() == 36 && requested_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') { requested_id } else { uuid::Uuid::new_v4().to_string() };
    let dir = shared.data_dir.join("audio");
    std::fs::create_dir_all(&dir).map_err(err)?;
    let file_name = format!("{id}.{ext}");
    let tmp = dir.join(format!("{file_name}.tmp"));
    std::fs::write(&tmp, bytes).map_err(err)?;
    std::fs::rename(&tmp, dir.join(&file_name)).map_err(err)?;
    let db = shared.db.lock().unwrap();
    if db.asset_file(&id).map_err(err)?.is_some() {
        db.delete_asset(&id).map_err(err)?;
    }
    db.insert_asset(&id, &name, if category.is_empty() { "General" } else { &category }, mime, bytes.len() as i64, &file_name).map_err(err)?;
    drop(db);
    let _ = app.emit("deskwell://changed", ());
    Ok(json!({ "id": id, "mime": mime }))
}

#[tauri::command]
pub fn list_audio(shared: S) -> R<Vec<Value>> {
    shared.db.lock().unwrap().list_assets().map_err(err)
}

#[tauri::command]
pub fn read_audio(shared: S, id: String) -> R<Response> {
    let (file, _) = shared.db.lock().unwrap().asset_file(&id).map_err(err)?.ok_or("audio not found")?;
    let bytes = std::fs::read(shared.data_dir.join("audio").join(file)).map_err(err)?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn update_audio(app: AppHandle, shared: S, id: String, name: Option<String>, category: Option<String>, duration_sec: Option<f64>) -> R<()> {
    shared.db.lock().unwrap().update_asset(&id, name.as_deref(), category.as_deref(), duration_sec).map_err(err)?;
    let _ = app.emit("deskwell://changed", ());
    Ok(())
}

#[tauri::command]
pub fn delete_audio(app: AppHandle, shared: S, id: String) -> R<()> {
    let db = shared.db.lock().unwrap();
    let refs = db.asset_references(&id).map_err(err)?;
    if !refs.is_empty() {
        return Err(format!("This audio is still used by: {}. Remove it from those reminders first.", refs.join(", ")));
    }
    if let Some((file, _)) = db.asset_file(&id).map_err(err)? {
        let _ = std::fs::remove_file(shared.data_dir.join("audio").join(file));
    }
    db.delete_asset(&id).map_err(err)?;
    drop(db);
    let _ = app.emit("deskwell://changed", ());
    Ok(())
}

// ----- backup -----

#[tauri::command]
pub fn export_data(shared: S, with_history: bool) -> R<Value> {
    let db = shared.db.lock().unwrap();
    let mut v = db.export_all(with_history).map_err(err)?;
    v["audio"] = json!(db.list_assets().map_err(err)?);
    Ok(v)
}

#[tauri::command]
pub fn import_data(app: AppHandle, shared: S, data: Value) -> R<()> {
    shared.db.lock().unwrap().import_all(&data).map_err(err)?;
    update_state(&shared, |s| *s = RuntimeState::default())?;
    changed(&app, &shared);
    Ok(())
}

/// Atomically write a backup file into <data>/backups and prune old automatic backups.
#[tauri::command]
pub fn write_backup_file(shared: S, name: String, contents: String, keep: Option<usize>) -> R<String> {
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.').collect();
    if safe.is_empty() || !safe.ends_with(".json") {
        return Err("invalid backup name".into());
    }
    let dir = shared.data_dir.join("backups");
    std::fs::create_dir_all(&dir).map_err(err)?;
    let path = dir.join(&safe);
    let tmp = dir.join(format!("{safe}.tmp"));
    std::fs::write(&tmp, contents.as_bytes()).map_err(err)?;
    std::fs::rename(&tmp, &path).map_err(err)?;
    if let Some(keep) = keep {
        let mut autos: Vec<_> = std::fs::read_dir(&dir)
            .map_err(err)?
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("auto-"))
            .collect();
        autos.sort_by_key(|e| e.file_name());
        while autos.len() > keep {
            let _ = std::fs::remove_file(autos.remove(0).path());
        }
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn list_backup_files(shared: S) -> R<Vec<String>> {
    let dir = shared.data_dir.join("backups");
    let mut v: Vec<String> = std::fs::read_dir(&dir).map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.ends_with(".json")).collect()).unwrap_or_default();
    v.sort();
    v.reverse();
    Ok(v)
}

#[tauri::command]
pub fn clear_history(app: AppHandle, shared: S) -> R<()> {
    let db = shared.db.lock().unwrap();
    db.conn
        .execute_batch("DELETE FROM reminder_events; DELETE FROM reminder_occurrences; DELETE FROM water_entries; DELETE FROM focus_sessions; DELETE FROM daily_summaries;")
        .map_err(err)?;
    drop(db);
    changed(&app, &shared);
    Ok(())
}

// ----- app shell -----

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> R<bool> {
    app.autolaunch().is_enabled().map_err(err)
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> R<()> {
    let al = app.autolaunch();
    if enabled {
        al.enable().map_err(err)
    } else {
        al.disable().map_err(err)
    }
}

#[tauri::command]
pub fn open_dashboard(app: AppHandle, page: Option<String>) -> R<()> {
    crate::show_main(&app, page);
    Ok(())
}

#[tauri::command]
pub fn hide_window(app: AppHandle, label: String) -> R<()> {
    if let Some(w) = app.get_webview_window(&label) {
        w.hide().map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
pub fn test_voice(app: AppHandle) -> R<()> {
    app.emit("deskwell://test-voice", ()).map_err(err)
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
