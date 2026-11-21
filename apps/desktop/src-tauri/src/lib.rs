//! DeskWell desktop shell: system tray / menu bar, windows, notifications and the native engine.

pub mod commands;
pub mod db;
pub mod engine;
pub mod model;
pub mod schedule;

use engine::{Shared, Shell};
use model::ActiveDelivery;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_positioner::{Position, WindowExt};

const TRAY_ID: &str = "deskwell-tray";

pub fn show_main(app: &AppHandle, page: Option<String>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        if let Some(p) = page {
            let _ = app.emit_to("main", "deskwell://navigate", p);
        }
    }
}

fn toggle_panel(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("panel") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let pos = if cfg!(target_os = "macos") { Position::TrayCenter } else { Position::TrayBottomCenter };
            if w.as_ref().window().move_window(pos).is_err() {
                let _ = w.as_ref().window().move_window(Position::BottomRight);
            }
            let _ = w.show();
            let _ = w.set_focus();
            let _ = app.emit_to("panel", "deskwell://changed", ());
        }
    }
}

/// Put the reminder popup in a corner of the current monitor's work area (taskbar/dock excluded).
/// Computed by hand because a hidden window may report a zero size to the positioner plugin.
fn place_popup(w: &tauri::WebviewWindow, pos: &str) {
    let Some(mon) = w.current_monitor().ok().flatten().or_else(|| w.primary_monitor().ok().flatten()) else { return };
    let scale = mon.scale_factor();
    let area = mon.work_area();
    let mut size = w.outer_size().unwrap_or_default();
    if size.width < 50 || size.height < 50 {
        size = tauri::PhysicalSize::new((400.0 * scale) as u32, (300.0 * scale) as u32);
    }
    let margin = (16.0 * scale) as i32;
    let (aw, ah) = (area.size.width as i32, area.size.height as i32);
    let (sw, sh) = (size.width as i32, size.height as i32);
    let x = match pos {
        "center" => area.position.x + (aw - sw) / 2,
        _ => area.position.x + aw - sw - margin,
    };
    let y = match pos {
        "center" => area.position.y + (ah - sh) / 2,
        "top-right" => area.position.y + margin,
        _ => area.position.y + ah - sh - margin,
    };
    let _ = w.set_position(tauri::PhysicalPosition::new(x.max(area.position.x), y.max(area.position.y)));
}

struct TauriShell {
    app: AppHandle,
}

impl Shell for TauriShell {
    fn deliver(&self, active: &ActiveDelivery, native: Option<(String, String)>) {
        if let Some((title, body)) = native {
            // A failure here (e.g. notifications denied) must never block the popup or voice.
            let _ = self.app.notification().builder().title(title).body(body).show();
        }
        if active.show_popup {
            if let Some(w) = self.app.get_webview_window("popup") {
                let pos = self
                    .app
                    .state::<Arc<Shared>>()
                    .db
                    .lock()
                    .ok()
                    .and_then(|db| db.get_json("settings").ok().flatten())
                    .and_then(|s| s["popupPosition"].as_str().map(String::from))
                    .unwrap_or_else(|| "bottom-right".into());
                place_popup(&w, &pos);
                let _ = w.show();
                let _ = w.set_always_on_top(true);
            }
        }
        let _ = self.app.emit("deskwell://deliver", active);
    }

    fn notify(&self, title: &str, body: &str) {
        let _ = self.app.notification().builder().title(title).body(body).show();
    }

    fn state_changed(&self, next: Option<(i64, String)>) {
        if let Some(tray) = self.app.tray_by_id(TRAY_ID) {
            let tip = match next {
                Some((at, name)) => {
                    let mins = ((at - engine::now_ms()) as f64 / 60_000.0).ceil().max(0.0) as i64;
                    format!("DeskWell: next {name} in {mins} min")
                }
                None => "DeskWell: no upcoming reminders".to_string(),
            };
            let _ = tray.set_tooltip(Some(tip));
        }
        let _ = self.app.emit("deskwell://tick", ());
    }

    fn timezone_changed(&self, from: &str, to: &str) {
        let _ = self.app.emit("deskwell://timezone-changed", serde_json::json!({ "from": from, "to": to }));
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open DeskWell", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause Reminders", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "resume", "Resume Reminders", true, None::<&str>)?;
    let focus = MenuItem::with_id(app, "focus", "Focus Mode (25 min)", true, None::<&str>)?;
    let test = MenuItem::with_id(app, "test_voice", "Play Test Voice", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Exit", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &sep, &pause, &resume, &focus, &test, &sep2, &settings, &quit])?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().cloned().expect("app icon"))
        .tooltip("DeskWell")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let shared = app.state::<Arc<Shared>>().inner().clone();
            match event.id().as_ref() {
                "open" => show_main(app, None),
                "pause" => {
                    let _ = commands::pause(app, &shared, Some("indefinite".into()));
                }
                "resume" => {
                    let _ = commands::pause(app, &shared, None);
                }
                "focus" => {
                    let _ = commands::focus(app, &shared, "focus".into(), 25, true, true, false);
                }
                "test_voice" => {
                    let _ = app.emit("deskwell://test-voice", ());
                }
                "settings" => show_main(app, Some("settings".into())),
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_panel(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app, None)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db = db::Db::open(&data_dir.join("deskwell.db")).map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
            let shared = Shared::new(db, data_dir);
            app.manage(shared.clone());

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            build_tray(app.handle())?;

            let minimized = std::env::args().any(|a| a == "--minimized");
            if !minimized {
                show_main(app.handle(), None);
            }

            engine::run(shared, Arc::new(TauriShell { app: app.handle().clone() }));
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing the dashboard hides it to the tray; only "Exit" quits.
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            WindowEvent::Focused(false) if window.label() == "panel" => {
                let _ = window.hide();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::init_defaults,
            commands::save_settings,
            commands::save_reminder,
            commands::delete_reminder,
            commands::save_template,
            commands::delete_template,
            commands::set_pause,
            commands::start_focus,
            commands::stop_focus,
            commands::act,
            commands::dismiss_popup,
            commands::add_water,
            commands::undo_water,
            commands::list_history,
            commands::import_audio,
            commands::list_audio,
            commands::read_audio,
            commands::update_audio,
            commands::delete_audio,
            commands::export_data,
            commands::import_data,
            commands::write_backup_file,
            commands::list_backup_files,
            commands::clear_history,
            commands::get_autostart,
            commands::set_autostart,
            commands::open_dashboard,
            commands::hide_window,
            commands::test_voice,
            commands::quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building DeskWell")
        .run(|app, event| {
            // Keep running in the tray when every window is hidden.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
                let _ = app;
            }
        });
}
