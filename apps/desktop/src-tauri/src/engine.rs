//! Background reminder engine. Runs on its own thread, independent of any window.
//! It sleeps until the next due occurrence (or at most 60 s, to notice clock, timezone and
//! sleep/wake changes cheaply) and wakes immediately when settings change.

use crate::db::Db;
use crate::model::{ActiveDelivery, Delivery, Reminder, RuntimeState, ScheduleSettings};
use crate::schedule::{self, Ctx, Kind, Plan};
use chrono_tz::Tz;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

pub const GRACE_MS: i64 = 90_000;
const MAX_SLEEP_MS: i64 = 60_000;
const AWAY_MS: i64 = 10 * 60_000;

pub struct Shared {
    pub db: Mutex<Db>,
    pub data_dir: PathBuf,
    pub active: Mutex<Option<ActiveDelivery>>,
    signal: (Mutex<bool>, Condvar),
}

/// What the engine asks the shell (tray, windows, notifications) to do.
pub trait Shell: Send + Sync + 'static {
    fn deliver(&self, active: &ActiveDelivery, native: Option<(String, String)>);
    fn notify(&self, title: &str, body: &str);
    fn state_changed(&self, next: Option<(i64, String)>);
    fn timezone_changed(&self, from: &str, to: &str);
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn system_tz() -> (String, Tz) {
    let name = iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".into());
    let tz = name.parse::<Tz>().unwrap_or(chrono_tz::UTC);
    (name, tz)
}

impl Shared {
    pub fn new(db: Db, data_dir: PathBuf) -> Arc<Self> {
        Arc::new(Self { db: Mutex::new(db), data_dir, active: Mutex::new(None), signal: (Mutex::new(false), Condvar::new()) })
    }

    /// Wake the engine to recompute (settings changed, action taken, resume...).
    pub fn poke(&self) {
        let (lock, cv) = &self.signal;
        *lock.lock().unwrap() = true;
        cv.notify_all();
    }

    fn wait(&self, ms: i64) {
        let (lock, cv) = &self.signal;
        let mut flag = lock.lock().unwrap();
        if !*flag {
            let (g, _) = cv.wait_timeout(flag, Duration::from_millis(ms.max(50) as u64)).unwrap();
            flag = g;
        }
        *flag = false;
    }
}

pub struct Loaded {
    pub reminders: Vec<Reminder>,
    pub settings_json: Value,
    pub schedule_settings: ScheduleSettings,
    pub state: RuntimeState,
    pub templates: Vec<Value>,
}

pub fn load(db: &Db) -> Loaded {
    let reminders: Vec<Reminder> = db.list_reminders().unwrap_or_default().into_iter().filter_map(|v| serde_json::from_value(v).ok()).collect();
    let settings_json = db.get_json("settings").ok().flatten().unwrap_or(json!({}));
    let schedule_settings: ScheduleSettings = serde_json::from_value(settings_json.clone())
        .unwrap_or_else(|_| serde_json::from_value(json!({})).unwrap());
    let state: RuntimeState = db.get_json("state").ok().flatten().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
    let templates = db.list_templates().unwrap_or_default();
    Loaded { reminders, settings_json, schedule_settings, state, templates }
}

pub fn compute_plan(l: &Loaded, tz: Tz, delivered: &HashSet<String>, after: i64) -> Option<Plan> {
    let ctx = Ctx { tz, settings: &l.schedule_settings };
    schedule::plan_next(&l.reminders, after, &ctx, &l.state, &|id| delivered.contains(id))
}

fn rand_index(n: usize) -> usize {
    if n <= 1 {
        return 0;
    }
    let b = uuid::Uuid::new_v4();
    (u64::from_le_bytes(b.as_bytes()[0..8].try_into().unwrap()) % n as u64) as usize
}

/// Port of pickMessage() in packages/domain/src/messages.ts.
pub fn pick_message(r: &Reminder, templates: &[Value]) -> String {
    let own: Vec<&String> = r.messages.iter().filter(|m| !m.trim().is_empty()).collect();
    if !own.is_empty() {
        return if r.random_message { own[rand_index(own.len())].clone() } else { own[0].clone() };
    }
    let pick = |lang: &str| -> Vec<String> {
        let mut v: Vec<&Value> = templates.iter().filter(|t| t["category"] == r.category.as_str() && t["language"] == lang).collect();
        v.sort_by_key(|t| t["order"].as_i64().unwrap_or(0));
        v.iter().filter_map(|t| t["text"].as_str().map(String::from)).collect()
    };
    let mut lib = pick(&r.language);
    if lib.is_empty() {
        lib = pick("en");
    }
    if lib.is_empty() {
        return r.name.clone();
    }
    if r.random_message {
        lib[rand_index(lib.len())].clone()
    } else {
        lib[0].clone()
    }
}

pub fn run(shared: Arc<Shared>, shell: Arc<dyn Shell>) {
    std::thread::Builder::new()
        .name("deskwell-engine".into())
        .spawn(move || loop {
            let sleep = tick(&shared, shell.as_ref());
            shared.wait(sleep);
        })
        .expect("spawn engine thread");
}

/// Shell calls collected during a tick and replayed after the database lock is released, so a shell
/// that touches the database (or the UI thread) can never deadlock with the engine.
enum Fx {
    Deliver(ActiveDelivery, Option<(String, String)>),
    Notify(String, String),
    State(Option<(i64, String)>),
    Timezone(String, String),
}

#[derive(Default)]
struct Buffered(Mutex<Vec<Fx>>);

impl Shell for Buffered {
    fn deliver(&self, active: &ActiveDelivery, native: Option<(String, String)>) {
        self.0.lock().unwrap().push(Fx::Deliver(active.clone(), native));
    }
    fn notify(&self, title: &str, body: &str) {
        self.0.lock().unwrap().push(Fx::Notify(title.into(), body.into()));
    }
    fn state_changed(&self, next: Option<(i64, String)>) {
        self.0.lock().unwrap().push(Fx::State(next));
    }
    fn timezone_changed(&self, from: &str, to: &str) {
        self.0.lock().unwrap().push(Fx::Timezone(from.into(), to.into()));
    }
}

/// One scheduling pass. Returns how long to sleep (ms).
pub fn tick(shared: &Shared, shell: &dyn Shell) -> i64 {
    let buf = Buffered::default();
    let sleep = tick_locked(shared, &buf);
    for fx in buf.0.into_inner().unwrap() {
        match fx {
            Fx::Deliver(a, n) => shell.deliver(&a, n),
            Fx::Notify(t, b) => shell.notify(&t, &b),
            Fx::State(n) => shell.state_changed(n),
            Fx::Timezone(f, t) => shell.timezone_changed(&f, &t),
        }
    }
    sleep
}

fn tick_locked(shared: &Shared, shell: &dyn Shell) -> i64 {
    let now = now_ms();
    let (tz_name, tz) = system_tz();
    let db = shared.db.lock().unwrap();
    let mut l = load(&db);
    // Not initialised yet: the UI writes the defaults on first launch. Never create a partial settings record.
    if l.settings_json.get("profiles").is_none() {
        return MAX_SLEEP_MS;
    }
    let mut settings_dirty = false;

    // Timezone change detection.
    let last_tz = l.settings_json["lastSeenTimeZone"].as_str().map(String::from);
    if last_tz.as_deref() != Some(tz_name.as_str()) {
        if let Some(from) = &last_tz {
            shell.timezone_changed(from, &tz_name);
            shell.notify("DeskWell", "Your timezone changed. DeskWell updated your local schedule.");
        }
        l.settings_json["lastSeenTimeZone"] = json!(tz_name);
        settings_dirty = true;
    }

    // Expire focus / pause; drop stale snoozes and mutes.
    if let Some(f) = &l.state.focus {
        if schedule::parse_iso(&f.ends_at).map(|e| e <= now).unwrap_or(true) {
            let _ = db.end_focus(&schedule::iso(now));
            l.state.focus = None;
            shell.notify("Focus finished", "Nice work. Your reminders are back on schedule.");
        }
    }
    if let Some(p) = l.state.paused_until.as_deref() {
        if p != "indefinite" && schedule::parse_iso(p).map(|t| t <= now).unwrap_or(true) {
            l.state.paused_until = None;
        }
    }
    l.state.snoozes.retain(|_, v| schedule::parse_iso(v).map(|t| t > now - GRACE_MS).unwrap_or(false));
    let today = schedule::date_str(schedule::local_date(now, tz));
    l.state.muted_today.retain(|_, d| *d == today);

    // "Welcome back" summary after sleep / app not running (never a burst of old reminders).
    if let Some(last) = l.state.last_tick_at.as_deref().and_then(schedule::parse_iso) {
        if now - last > AWAY_MS && l.settings_json["catchUp"] == "summary" && l.state.paused_until.is_none() {
            let ctx = Ctx { tz, settings: &l.schedule_settings };
            let missed: usize = l.reminders.iter().filter(|r| r.enabled).map(|r| schedule::occurrences_between(r, last, now - GRACE_MS, &ctx, 50).len()).sum();
            if missed > 0 {
                shell.notify("Welcome back", &format!("{missed} reminders were skipped while you were away. Your schedule continues from now."));
            }
        }
    }
    l.state.last_tick_at = Some(schedule::iso(now));

    if settings_dirty {
        let _ = db.set_json("settings", &l.settings_json);
    }
    // last_tick_at changes every tick, so state is always written.
    let _ = db.set_json("state", &serde_json::to_value(&l.state).unwrap());

    let delivered = db.delivered_since(&schedule::iso(now - 2 * 86_400_000)).unwrap_or_default();
    let plan = compute_plan(&l, tz, &delivered, now - GRACE_MS);
    match plan {
        Some(p) if p.at <= now => {
            deliver(&db, shared, shell, &mut l, &p, &tz_name, now);
            0
        }
        Some(p) => {
            let names: Vec<String> = p.items.iter().filter_map(|i| l.reminders.iter().find(|r| r.id == i.reminder_id).map(|r| r.name.clone())).collect();
            shell.state_changed(Some((p.at, names.join(" + "))));
            (p.at - now).min(MAX_SLEEP_MS)
        }
        None => {
            shell.state_changed(None);
            MAX_SLEEP_MS
        }
    }
}

fn deliver(db: &Db, shared: &Shared, shell: &dyn Shell, l: &mut Loaded, plan: &Plan, tz_name: &str, now: i64) {
    let mut items: Vec<Delivery> = vec![];
    for it in &plan.items {
        let Some(r) = l.reminders.iter().find(|r| r.id == it.reminder_id) else { continue };
        let fresh = db.record_occurrence(&it.occurrence_id, &r.id, &schedule::iso(it.scheduled_at), tz_name, "delivered").unwrap_or(false);
        if it.kind == Kind::Snooze {
            l.state.snoozes.remove(&r.id);
        }
        if !fresh {
            continue;
        }
        let _ = db.add_event(&json!({
            "id": uuid::Uuid::new_v4().to_string(), "occurrenceId": it.occurrence_id, "reminderId": r.id, "category": r.category,
            "action": "delivered", "scheduledAt": schedule::iso(it.scheduled_at), "at": schedule::iso(now), "timeZone": tz_name,
            "detail": match it.kind { Kind::Deferred => Some("deferred by focus"), Kind::Snooze => Some("after snooze"), Kind::Natural => None },
        }));
        items.push(Delivery {
            occurrence_id: it.occurrence_id.clone(),
            reminder_id: r.id.clone(),
            name: r.name.clone(),
            category: r.category.clone(),
            message: pick_message(r, &l.templates),
            scheduled_at: schedule::iso(it.scheduled_at),
            delivery: r.delivery.clone(),
            voice: r.voice.clone(),
            language: r.language.clone(),
            snooze_options: r.snooze_options.clone(),
            priority: r.priority.clone(),
        });
    }
    let _ = db.set_json("state", &serde_json::to_value(&l.state).unwrap());
    if items.is_empty() {
        return;
    }
    let focus = l.state.focus.as_ref();
    let wants_popup = items.iter().any(|d| d.delivery == "popup_voice" || d.delivery == "popup");
    let wants_voice = items.iter().any(|d| d.delivery == "popup_voice" || d.delivery == "voice");
    let show_popup = wants_popup && !focus.map(|f| f.pause_popup).unwrap_or(false);
    let play_voice = wants_voice && !focus.map(|f| f.pause_voice).unwrap_or(false);
    let wants_native = l.settings_json["nativeNotifications"].as_bool().unwrap_or(true)
        && items.iter().any(|d| d.delivery != "voice" && d.delivery != "disabled");
    let native = if wants_native {
        let title = items.iter().map(|d| d.name.clone()).collect::<Vec<_>>().join(" + ");
        let body = items.iter().map(|d| d.message.clone()).collect::<Vec<_>>().join(" ");
        Some((title, body))
    } else {
        None
    };
    let active = {
        let mut guard = shared.active.lock().unwrap();
        let mut merged = guard.take().map(|a| a.items).unwrap_or_default();
        merged.retain(|d| !items.iter().any(|n| n.reminder_id == d.reminder_id));
        merged.extend(items);
        let a = ActiveDelivery { items: merged, show_popup, play_voice, created_at: schedule::iso(now) };
        *guard = Some(a.clone());
        a
    };
    shell.deliver(&active, native);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    /// A shell that touches the database from inside its callbacks, like the real tray shell does.
    struct DbShell(Arc<Shared>, Mutex<Vec<String>>);
    impl Shell for DbShell {
        fn deliver(&self, active: &ActiveDelivery, _: Option<(String, String)>) {
            let _ = self.0.db.lock().unwrap().get_json("settings");
            self.1.lock().unwrap().extend(active.items.iter().map(|d| d.reminder_id.clone()));
        }
        fn notify(&self, _: &str, _: &str) {
            let _ = self.0.db.lock().unwrap().get_json("settings");
        }
        fn state_changed(&self, _: Option<(i64, String)>) {
            let _ = self.0.db.lock().unwrap().get_json("state");
        }
        fn timezone_changed(&self, _: &str, _: &str) {}
    }

    #[test]
    fn delivers_without_deadlock_and_only_once() {
        let shared = Shared::new(Db::open_in_memory().unwrap(), std::env::temp_dir());
        let now = now_ms();
        let hm = |ms: i64| {
            let (_, tz) = system_tz();
            let p = schedule::local_parts(ms, tz);
            format!("{:02}:{:02}", p.minutes / 60, p.minutes % 60)
        };
        {
            let db = shared.db.lock().unwrap();
            db.set_json(
                "settings",
                &json!({ "profiles": [{ "id": "o", "name": "O", "days": [1,2,3,4,5,6,7], "start": "00:00", "end": "00:00", "breaks": [] }],
                         "activeProfileId": "o", "workEnabled": false, "quietHours": [], "lastSeenTimeZone": system_tz().0 }),
            )
            .unwrap();
            db.upsert_reminder(&json!({
                "id": "r1", "name": "Due", "category": "water", "messages": [], "randomMessage": true, "language": "en", "enabled": true,
                "schedule": { "type": "daily", "intervalMinutes": 30, "times": [hm(now)], "days": [1,2,3,4,5,6,7], "dates": [], "onceAt": null,
                              "window": null, "useWorkHours": false, "startDate": null, "endDate": null },
                "delivery": "popup_voice", "voice": { "mode": "pack", "packId": "akib", "profileId": null, "audioIds": [], "randomAudio": false, "volume": 1 },
                "snoozeOptions": [5], "snoozePolicy": "wait", "priority": "normal", "respectQuietHours": false, "group": true, "pauseInFocus": true,
                "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z", "revision": 0
            }))
            .unwrap();
        }
        let shell = DbShell(shared.clone(), Mutex::new(vec![]));
        let (tx, rx) = std::sync::mpsc::channel();
        let s2 = shared.clone();
        std::thread::spawn(move || {
            let shell = DbShell(s2.clone(), Mutex::new(vec![]));
            tick(&s2, &shell);
            tick(&s2, &shell);
            tx.send(shell.1.into_inner().unwrap()).unwrap();
        });
        let delivered = rx.recv_timeout(Duration::from_secs(10)).expect("engine tick deadlocked");
        // The current minute (start) is within the 90 s grace window, so it is delivered exactly once.
        assert_eq!(delivered, vec!["r1".to_string()]);
        drop(shell);
    }
}
