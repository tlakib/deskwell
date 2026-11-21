//! Typed mirror of the shared TypeScript domain models (packages/domain/src/types.ts).
//! Field names and defaults must match the zod schemas; the shared fixture tests enforce the
//! scheduling behaviour.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

fn d_true() -> bool {
    true
}
fn d_interval() -> u32 {
    30
}
fn d_weekdays() -> Vec<u8> {
    vec![1, 2, 3, 4, 5]
}
fn d_all_days() -> Vec<u8> {
    vec![1, 2, 3, 4, 5, 6, 7]
}
fn d_snooze() -> Vec<u32> {
    vec![5, 10, 15]
}
fn d_one() -> f64 {
    1.0
}
fn d_office() -> String {
    "office".into()
}
fn d_popup_voice() -> String {
    "popup_voice".into()
}
fn d_normal() -> String {
    "normal".into()
}
fn d_wait() -> String {
    "wait".into()
}
fn d_en() -> String {
    "en".into()
}
fn d_pack() -> String {
    "pack".into()
}
fn d_akib() -> String {
    "akib".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TimeWindow {
    pub start: String,
    pub end: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default = "d_interval")]
    pub interval_minutes: u32,
    #[serde(default)]
    pub times: Vec<String>,
    #[serde(default = "d_weekdays")]
    pub days: Vec<u8>,
    #[serde(default)]
    pub dates: Vec<String>,
    #[serde(default)]
    pub once_at: Option<String>,
    #[serde(default)]
    pub window: Option<TimeWindow>,
    #[serde(default = "d_true")]
    pub use_work_hours: bool,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceChoice {
    #[serde(default = "d_pack")]
    pub mode: String,
    #[serde(default = "d_akib")]
    pub pack_id: String,
    #[serde(default)]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub audio_ids: Vec<String>,
    #[serde(default)]
    pub random_audio: bool,
    #[serde(default = "d_one")]
    pub volume: f64,
}

impl Default for VoiceChoice {
    fn default() -> Self {
        Self { mode: d_pack(), pack_id: d_akib(), profile_id: None, audio_ids: vec![], random_audio: false, volume: 1.0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub id: String,
    pub name: String,
    pub category: String,
    #[serde(default)]
    pub messages: Vec<String>,
    #[serde(default = "d_true")]
    pub random_message: bool,
    #[serde(default = "d_en")]
    pub language: String,
    #[serde(default = "d_true")]
    pub enabled: bool,
    pub schedule: Schedule,
    #[serde(default = "d_popup_voice")]
    pub delivery: String,
    #[serde(default)]
    pub voice: VoiceChoice,
    #[serde(default = "d_snooze")]
    pub snooze_options: Vec<u32>,
    #[serde(default = "d_wait")]
    pub snooze_policy: String,
    #[serde(default = "d_normal")]
    pub priority: String,
    #[serde(default = "d_true")]
    pub respect_quiet_hours: bool,
    #[serde(default = "d_true")]
    pub group: bool,
    #[serde(default = "d_true")]
    pub pause_in_focus: bool,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuietHours {
    #[serde(default)]
    pub id: String,
    #[serde(default = "d_true")]
    pub enabled: bool,
    pub start: String,
    pub end: String,
    #[serde(default = "d_all_days")]
    pub days: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BreakWindow {
    #[serde(default)]
    pub name: String,
    pub start: String,
    pub end: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkProfile {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default = "d_weekdays")]
    pub days: Vec<u8>,
    pub start: String,
    pub end: String,
    #[serde(default)]
    pub breaks: Vec<BreakWindow>,
}

/// The subset of settings the native layer needs. The full settings JSON is stored as-is.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleSettings {
    #[serde(default = "d_true")]
    pub work_enabled: bool,
    #[serde(default = "d_office")]
    pub active_profile_id: String,
    #[serde(default)]
    pub profiles: Vec<WorkProfile>,
    #[serde(default)]
    pub quiet_hours: Vec<QuietHours>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FocusState {
    pub kind: String,
    pub started_at: String,
    pub ends_at: String,
    pub pause_voice: bool,
    pub pause_popup: bool,
    #[serde(default)]
    pub hold_all: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeState {
    #[serde(default)]
    pub paused_until: Option<String>,
    #[serde(default)]
    pub focus: Option<FocusState>,
    #[serde(default)]
    pub snoozes: HashMap<String, String>,
    #[serde(default)]
    pub muted_today: HashMap<String, String>,
    #[serde(default)]
    pub last_tick_at: Option<String>,
}

/// A due occurrence handed to the UI (popup + voice). Mirrors `Delivery` in TS.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Delivery {
    pub occurrence_id: String,
    pub reminder_id: String,
    pub name: String,
    pub category: String,
    pub message: String,
    pub scheduled_at: String,
    pub delivery: String,
    pub voice: VoiceChoice,
    pub language: String,
    pub snooze_options: Vec<u32>,
    pub priority: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveDelivery {
    pub items: Vec<Delivery>,
    /// Effective flags after Focus/Meeting mode is applied.
    pub show_popup: bool,
    pub play_voice: bool,
    pub created_at: String,
}
