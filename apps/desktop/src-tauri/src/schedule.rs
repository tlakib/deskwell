//! Native port of packages/domain/src/schedule.ts. Both implementations run the same fixture file
//! (packages/domain/fixtures/schedule-cases.json) in their test suites.

use crate::model::{Reminder, RuntimeState, ScheduleSettings, TimeWindow, WorkProfile};
use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveDateTime, Offset, TimeZone, Timelike, Utc};
use chrono_tz::Tz;

pub const DAY_MINUTES: i64 = 24 * 60;
pub const SEARCH_DAYS: i64 = 400;

pub struct Ctx<'a> {
    pub tz: Tz,
    pub settings: &'a ScheduleSettings,
}

pub fn parse_hm(hm: &str) -> i64 {
    let mut it = hm.split(':');
    let h: i64 = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    let m: i64 = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    h * 60 + m
}

pub fn parse_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

pub fn iso(ms: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(ms)
        .map(|d| d.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
        .unwrap_or_default()
}

pub fn parse_iso(s: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(s).ok().map(|d| d.timestamp_millis())
}

/// Local date + minutes after its midnight (may exceed a day) -> epoch ms.
/// Gap times move forward by the gap; overlapping times resolve to the later instant (matches Luxon).
pub fn local_to_instant(date: NaiveDate, minutes: i64, tz: Tz) -> i64 {
    let naive: NaiveDateTime = date.and_hms_opt(0, 0, 0).unwrap() + Duration::minutes(minutes);
    match tz.from_local_datetime(&naive) {
        LocalResult::Single(dt) => dt.timestamp_millis(),
        LocalResult::Ambiguous(a, b) => a.timestamp_millis().max(b.timestamp_millis()),
        LocalResult::None => {
            // Use the offset in effect just before the gap.
            let mut offset_secs: i64 = 0;
            for k in 1..=240 {
                if let LocalResult::Single(dt) = tz.from_local_datetime(&(naive - Duration::minutes(k))) {
                    offset_secs = dt.offset().fix().local_minus_utc() as i64;
                    break;
                }
            }
            (naive.and_utc().timestamp() - offset_secs) * 1000
        }
    }
}

pub struct LocalParts {
    pub date: NaiveDate,
    pub minutes: i64,
    pub weekday: u8,
}

pub fn local_parts(ms: i64, tz: Tz) -> LocalParts {
    let dt = tz.timestamp_millis_opt(ms).single().unwrap_or_else(|| tz.timestamp_millis_opt(0).unwrap());
    LocalParts {
        date: dt.date_naive(),
        minutes: dt.hour() as i64 * 60 + dt.minute() as i64,
        weekday: dt.weekday().number_from_monday() as u8,
    }
}

pub fn local_date(ms: i64, tz: Tz) -> NaiveDate {
    local_parts(ms, tz).date
}

pub fn date_str(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

pub fn start_of_local_day(date: NaiveDate, tz: Tz) -> i64 {
    local_to_instant(date, 0, tz)
}

pub fn next_local_midnight(ms: i64, tz: Tz) -> i64 {
    start_of_local_day(local_date(ms, tz) + Duration::days(1), tz)
}

pub fn window_bounds(w: &TimeWindow) -> (i64, i64) {
    let s = parse_hm(&w.start);
    let mut e = parse_hm(&w.end);
    if e <= s {
        e += DAY_MINUTES;
    }
    (s, e)
}

pub fn in_recurring_window(p: &LocalParts, start: &str, end: &str, days: &[u8]) -> bool {
    let (s, e) = window_bounds(&TimeWindow { start: start.into(), end: end.into() });
    if days.contains(&p.weekday) && p.minutes >= s && p.minutes < e {
        return true;
    }
    if e > DAY_MINUTES {
        let prev = if p.weekday == 1 { 7 } else { p.weekday - 1 };
        let m = p.minutes + DAY_MINUTES;
        if days.contains(&prev) && m >= s && m < e {
            return true;
        }
    }
    false
}

pub fn active_profile(s: &ScheduleSettings) -> Option<&WorkProfile> {
    if !s.work_enabled {
        return None;
    }
    s.profiles.iter().find(|p| p.id == s.active_profile_id).or_else(|| s.profiles.first())
}

struct Effective<'a> {
    days: Vec<u8>,
    window: Option<TimeWindow>,
    profile: Option<&'a WorkProfile>,
}

fn effective<'a>(r: &Reminder, ctx: &'a Ctx) -> Effective<'a> {
    let s = &r.schedule;
    if let Some(w) = &s.window {
        return Effective { days: s.days.clone(), window: Some(w.clone()), profile: None };
    }
    if s.use_work_hours {
        if let Some(p) = active_profile(ctx.settings) {
            return Effective {
                days: s.days.iter().copied().filter(|d| p.days.contains(d)).collect(),
                window: Some(TimeWindow { start: p.start.clone(), end: p.end.clone() }),
                profile: Some(p),
            };
        }
    }
    Effective { days: s.days.clone(), window: None, profile: None }
}

pub fn minutes_for_day(r: &Reminder, date: NaiveDate, ctx: &Ctx) -> Vec<i64> {
    let s = &r.schedule;
    let ds = date_str(date);
    if let Some(sd) = &s.start_date {
        if ds.as_str() < sd.as_str() {
            return vec![];
        }
    }
    if let Some(ed) = &s.end_date {
        if ds.as_str() > ed.as_str() {
            return vec![];
        }
    }
    let wd = date.weekday().number_from_monday() as u8;
    let mut out: Vec<i64> = vec![];
    match s.kind.as_str() {
        "once" => {
            if let Some(at) = &s.once_at {
                if at.len() >= 16 && &at[0..10] == ds.as_str() {
                    out.push(parse_hm(&at[11..16]));
                }
            }
        }
        "dates" => {
            if s.dates.iter().any(|d| d == &ds) {
                out.extend(s.times.iter().map(|t| parse_hm(t)));
            }
        }
        "daily" => {
            if s.days.contains(&wd) {
                out.extend(s.times.iter().map(|t| parse_hm(t)));
            }
        }
        "interval" => {
            let eff = effective(r, ctx);
            if eff.days.contains(&wd) {
                let (ws, we) = eff.window.as_ref().map(window_bounds).unwrap_or((0, DAY_MINUTES));
                let step = s.interval_minutes.max(1) as i64;
                let mut m = ws + step;
                while m <= we {
                    out.push(m);
                    m += step;
                }
            }
            if s.days.contains(&wd) {
                out.extend(s.times.iter().map(|t| parse_hm(t)));
            }
        }
        _ => {}
    }
    out.sort_unstable();
    out.dedup();
    out
}

pub fn is_blocked(r: &Reminder, instant: i64, ctx: &Ctx) -> bool {
    let p = local_parts(instant, ctx.tz);
    if r.respect_quiet_hours {
        for q in &ctx.settings.quiet_hours {
            if q.enabled && in_recurring_window(&p, &q.start, &q.end, &q.days) {
                return true;
            }
        }
    }
    if r.schedule.kind == "interval" && r.schedule.window.is_none() && r.schedule.use_work_hours {
        if let Some(profile) = effective(r, ctx).profile {
            for b in &profile.breaks {
                if in_recurring_window(&p, &b.start, &b.end, &profile.days) {
                    return true;
                }
            }
        }
    }
    false
}

pub fn next_occurrence(r: &Reminder, after: i64, ctx: &Ctx, skip: &dyn Fn(i64) -> bool) -> Option<i64> {
    let start = local_date(after, ctx.tz) - Duration::days(1);
    let mut best: Option<i64> = None;
    for i in 0..SEARCH_DAYS {
        let date = start + Duration::days(i);
        for m in minutes_for_day(r, date, ctx) {
            let t = local_to_instant(date, m, ctx.tz);
            if t <= after {
                continue;
            }
            if let Some(b) = best {
                if t >= b {
                    continue;
                }
            }
            if is_blocked(r, t, ctx) || skip(t) {
                continue;
            }
            best = Some(t);
        }
        if let Some(b) = best {
            if b < start_of_local_day(date + Duration::days(1), ctx.tz) {
                break;
            }
        }
    }
    best
}

pub fn occurrences_between(r: &Reminder, from: i64, to: i64, ctx: &Ctx, limit: usize) -> Vec<i64> {
    let mut out = vec![];
    let mut cur = from;
    while out.len() < limit {
        match next_occurrence(r, cur, ctx, &|_| false) {
            Some(n) if n <= to => {
                out.push(n);
                cur = n;
            }
            _ => break,
        }
    }
    out
}

pub fn occurrence_id(reminder_id: &str, instant: i64) -> String {
    format!("{}@{}", reminder_id, iso(instant))
}

pub fn snooze_occurrence_id(reminder_id: &str, until: &str) -> String {
    format!("{}@snooze@{}", reminder_id, until)
}

#[derive(Debug, Clone, PartialEq)]
pub enum Kind {
    Natural,
    Snooze,
    Deferred,
}

#[derive(Debug, Clone)]
pub struct PlanItem {
    pub reminder_id: String,
    pub occurrence_id: String,
    pub at: i64,
    pub scheduled_at: i64,
    pub kind: Kind,
}

#[derive(Debug, Clone)]
pub struct Plan {
    pub at: i64,
    pub items: Vec<PlanItem>,
}

pub fn candidate_for(r: &Reminder, after: i64, ctx: &Ctx, state: &RuntimeState, is_delivered: &dyn Fn(&str) -> bool) -> Option<PlanItem> {
    if !r.enabled || r.delivery == "disabled" {
        return None;
    }
    if state.paused_until.as_deref() == Some("indefinite") {
        return None;
    }
    let mut floor = after;
    if let Some(pu) = state.paused_until.as_deref().and_then(parse_iso) {
        if pu > floor {
            floor = pu - 1;
        }
    }
    if let Some(muted) = state.muted_today.get(&r.id) {
        if *muted == date_str(local_date(after, ctx.tz)) {
            floor = floor.max(next_local_midnight(after, ctx.tz) - 1);
        }
    }

    let mut snooze: Option<PlanItem> = None;
    if let Some(s_iso) = state.snoozes.get(&r.id) {
        if let Some(s) = parse_iso(s_iso) {
            if s > after {
                let id = snooze_occurrence_id(&r.id, s_iso);
                if !is_delivered(&id) {
                    snooze = Some(PlanItem { reminder_id: r.id.clone(), occurrence_id: id, at: s.max(floor + 1), scheduled_at: s, kind: Kind::Snooze });
                }
                if r.snooze_policy == "wait" {
                    floor = floor.max(s);
                }
            }
        }
    }

    let rid = r.id.clone();
    let skip = move |t: i64| is_delivered(&occurrence_id(&rid, t));
    let mut natural = next_occurrence(r, floor, ctx, &skip);

    let focus = state.focus.as_ref();
    let holds = focus.map(|f| r.pause_in_focus && (f.kind == "focus" || f.hold_all)).unwrap_or(false);
    let focus_end = focus.and_then(|f| parse_iso(&f.ends_at)).unwrap_or(0);

    let mut natural_item: Option<PlanItem> = None;
    if let Some(n) = natural {
        if holds && n < focus_end {
            if r.priority == "important" {
                natural_item = Some(PlanItem { reminder_id: r.id.clone(), occurrence_id: occurrence_id(&r.id, n), at: focus_end, scheduled_at: n, kind: Kind::Deferred });
            } else {
                natural = next_occurrence(r, focus_end - 1, ctx, &skip);
            }
        }
        if natural_item.is_none() {
            if let Some(n) = natural {
                natural_item = Some(PlanItem { reminder_id: r.id.clone(), occurrence_id: occurrence_id(&r.id, n), at: n, scheduled_at: n, kind: Kind::Natural });
            }
        }
    }
    if let Some(s) = snooze.as_mut() {
        if holds && s.at < focus_end {
            s.at = focus_end;
        }
    }
    match (snooze, natural_item) {
        (Some(s), Some(n)) => Some(if s.at <= n.at { s } else { n }),
        (s, n) => s.or(n),
    }
}

pub fn plan_next(reminders: &[Reminder], after: i64, ctx: &Ctx, state: &RuntimeState, is_delivered: &dyn Fn(&str) -> bool) -> Option<Plan> {
    let mut cands: Vec<(&Reminder, PlanItem)> =
        reminders.iter().filter_map(|r| candidate_for(r, after, ctx, state, is_delivered).map(|c| (r, c))).collect();
    if cands.is_empty() {
        return None;
    }
    cands.sort_by(|a, b| a.1.at.cmp(&b.1.at).then_with(|| a.0.id.cmp(&b.0.id)));
    let (first_r, first_c) = cands[0].clone();
    let mut items = vec![first_c.clone()];
    if first_r.group {
        for (r, c) in cands.iter().skip(1) {
            if r.group && c.at - first_c.at < 60_000 {
                items.push(c.clone());
            }
        }
    }
    Some(Plan { at: first_c.at, items })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn merge(base: &Value, over: &Value) -> Value {
        let mut b = base.clone();
        if let (Some(bo), Some(oo)) = (b.as_object_mut(), over.as_object()) {
            for (k, v) in oo {
                bo.insert(k.clone(), v.clone());
            }
        }
        b
    }

    #[test]
    fn shared_fixtures() {
        let raw = include_str!("../../../../packages/domain/fixtures/schedule-cases.json");
        let fx: Value = serde_json::from_str(raw).unwrap();
        let base = &fx["baseSettings"];
        let mut failures = vec![];
        for c in fx["cases"].as_array().unwrap() {
            let name = c["name"].as_str().unwrap();
            let settings: ScheduleSettings = serde_json::from_value(merge(base, c.get("settings").unwrap_or(&Value::Null))).unwrap();
            let mut rj = serde_json::json!({ "id": "r1", "name": "Test", "category": "walk" });
            for (k, v) in c["reminder"].as_object().unwrap() {
                rj[k] = v.clone();
            }
            let r: Reminder = serde_json::from_value(rj).unwrap();
            let state: RuntimeState = c.get("state").map(|s| serde_json::from_value(s.clone()).unwrap()).unwrap_or_default();
            let delivered: Vec<String> = c.get("delivered").map(|d| serde_json::from_value(d.clone()).unwrap()).unwrap_or_default();
            let tz: Tz = c["zone"].as_str().unwrap().parse().unwrap();
            let ctx = Ctx { tz, settings: &settings };
            let after = parse_iso(c["after"].as_str().unwrap()).unwrap();
            let got = candidate_for(&r, after, &ctx, &state, &|id| delivered.iter().any(|d| d == id));
            let expect = c["expect"].as_str().map(|e| iso(parse_iso(e).unwrap()));
            let got_iso = got.as_ref().map(|g| iso(g.at));
            if got_iso != expect {
                failures.push(format!("{name}: expected {expect:?}, got {got_iso:?}"));
            }
            if let (Some(k), Some(g)) = (c.get("expectKind").and_then(|k| k.as_str()), got.as_ref()) {
                let gk = match g.kind {
                    Kind::Natural => "natural",
                    Kind::Snooze => "snooze",
                    Kind::Deferred => "deferred",
                };
                if gk != k {
                    failures.push(format!("{name}: expected kind {k}, got {gk}"));
                }
            }
        }
        assert!(failures.is_empty(), "fixture failures:\n{}", failures.join("\n"));
    }

    #[test]
    fn grouping_and_no_backlog() {
        let settings: ScheduleSettings = serde_json::from_value(serde_json::json!({
            "profiles": [{ "id": "office", "days": [1,2,3,4,5], "start": "09:00", "end": "18:00" }]
        }))
        .unwrap();
        let mk = |id: &str, mins: u32| -> Reminder {
            serde_json::from_value(serde_json::json!({ "id": id, "name": id, "category": "water", "schedule": { "type": "interval", "intervalMinutes": mins } })).unwrap()
        };
        let rs = vec![mk("a", 30), mk("b", 60)];
        let ctx = Ctx { tz: chrono_tz::UTC, settings: &settings };
        let plan = plan_next(&rs, parse_iso("2026-11-23T09:31:00Z").unwrap(), &ctx, &RuntimeState::default(), &|_| false).unwrap();
        assert_eq!(plan.items.len(), 2);
        assert_eq!(iso(plan.at), "2026-11-23T10:00:00.000Z");
        let wake = parse_iso("2026-11-23T15:02:30Z").unwrap();
        let plan = plan_next(&[mk("c", 5)], wake - 90_000, &ctx, &RuntimeState::default(), &|_| false).unwrap();
        assert_eq!(iso(plan.at), "2026-11-23T15:05:00.000Z");
    }
}
