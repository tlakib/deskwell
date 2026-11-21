/// <reference types="chrome" />
import { defaultReminders, defaultSettings, defaultTemplates, nowIso, packClipPath, LANGUAGE_TAGS, type Delivery, type Settings, type VoicePackId } from "@deskwell/domain";
import { act, initDefaults, kvGet } from "./core";
import { HEARTBEAT_ALARM, TICK_ALARM, tick, type EngineShell } from "./engine";

const OFFSCREEN = "offscreen.html";

async function ensureOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (ctx.length) return;
  try {
    await chrome.offscreen.createDocument({ url: OFFSCREEN, reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK], justification: "Play DeskWell voice reminders" });
  } catch (e) {
    if (!String(e).includes("single offscreen")) throw e;
  }
}

function speakTts(d: Delivery, settings: Settings): Promise<void> {
  const prof = settings.voiceProfiles.find((p) => p.id === (d.voice.profileId ?? settings.defaultVoiceProfileId)) ?? settings.voiceProfiles[0];
  return new Promise((resolve) => {
    chrome.tts.speak(d.message, {
      lang: LANGUAGE_TAGS[d.language].bcp47,
      voiceName: prof?.voiceName ?? undefined,
      rate: prof?.rate ?? 1,
      pitch: prof?.pitch ?? 1,
      volume: Math.min(1, (prof?.volume ?? 1) * d.voice.volume * settings.masterVolume),
      onEvent: (e) => {
        if (["end", "interrupted", "cancelled", "error"].includes(e.type)) resolve();
      },
    });
    setTimeout(resolve, 30_000);
  });
}

async function playVoice(items: Delivery[], settings: Settings) {
  for (const d of items) {
    const v = d.voice;
    if (v.mode === "none") continue;
    const volume = v.volume * settings.masterVolume;
    let ok = false;
    try {
      if (v.mode === "pack" || v.mode === "audio") {
        await ensureOffscreen();
        const msg =
          v.mode === "pack"
            ? { target: "offscreen", type: "play-url", url: chrome.runtime.getURL(packClipPath(v.packId as VoicePackId, d.category, d.language)), volume }
            : { target: "offscreen", type: "play-audio", ids: v.audioIds, random: v.randomAudio, volume };
        const res = (await chrome.runtime.sendMessage(msg)) as { ok: boolean } | undefined;
        ok = !!res?.ok;
      }
    } catch (e) {
      console.warn("DeskWell audio failed", e);
    }
    if (!ok) await speakTts(d, settings);
  }
}

async function stopVoice() {
  chrome.tts.stop();
  const ctx = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (ctx.length) await chrome.runtime.sendMessage({ target: "offscreen", type: "stop" }).catch(() => undefined);
}

async function popupWindowId(): Promise<number | null> {
  const { popupWindowId } = (await chrome.storage.session.get("popupWindowId")) as { popupWindowId?: number };
  if (popupWindowId === undefined) return null;
  try {
    await chrome.windows.get(popupWindowId);
    return popupWindowId;
  } catch {
    return null;
  }
}

async function showPopup() {
  const existing = await popupWindowId();
  if (existing !== null) {
    await chrome.windows.update(existing, { focused: true, drawAttention: true });
    return;
  }
  const width = 420;
  const height = 340;
  let left: number | undefined;
  let top: number | undefined;
  try {
    const w = await chrome.windows.getLastFocused();
    if (w.left !== undefined && w.width !== undefined && w.top !== undefined && w.height !== undefined) {
      left = Math.max(0, w.left + w.width - width - 24);
      top = Math.max(0, w.top + w.height - height - 24);
    }
  } catch {
    /* no window: let Chrome place it */
  }
  const win = await chrome.windows.create({ url: "reminder.html#/popup", type: "popup", width, height, left, top, focused: true });
  if (win?.id !== undefined) await chrome.storage.session.set({ popupWindowId: win.id });
}

async function closePopup() {
  const id = await popupWindowId();
  if (id !== null) await chrome.windows.remove(id).catch(() => undefined);
}

const shell: EngineShell = {
  async notify(id, title, message, buttons) {
    const opts: chrome.notifications.NotificationCreateOptions = { type: "basic", iconUrl: "icons/128.png", title, message, priority: 1 };
    if (buttons) opts.buttons = [{ title: "Done" }, { title: "Snooze 5 min" }];
    await new Promise<void>((r) => chrome.notifications.create(id, opts, () => r()));
  },
  showPopup,
  playVoice,
  async schedule(at) {
    await chrome.alarms.clear(TICK_ALARM);
    if (at !== null) await chrome.alarms.create(TICK_ALARM, { when: Math.max(Date.now() + 1000, at) });
    await setBadge(at);
  },
  idleState: () => new Promise((r) => chrome.idle.queryState(60, (s) => r(s as "active" | "idle" | "locked"))),
};

async function setBadge(at: number | null) {
  const { state } = await kvGet();
  const paused = state?.pausedUntil != null;
  await chrome.action.setBadgeText({ text: paused ? "II" : state?.focus ? "F" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#6d5dfc" });
  await chrome.action.setTitle({ title: paused ? "DeskWell – paused" : at ? `DeskWell – next reminder at ${new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "DeskWell" });
}

async function ensureHeartbeat() {
  // Recreated on install/startup: catches clock and timezone changes and wake from sleep.
  if (!(await chrome.alarms.get(HEARTBEAT_ALARM))) await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(async () => {
  const t = nowIso();
  await initDefaults(defaultSettings(t), defaultReminders(t), defaultTemplates());
  await ensureHeartbeat();
  await tick(shell);
});
chrome.runtime.onStartup.addListener(async () => {
  await ensureHeartbeat();
  await tick(shell);
});
chrome.alarms.onAlarm.addListener(() => void tick(shell));
chrome.idle.onStateChanged.addListener(() => void tick(shell));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.settings || changes.reminders || changes.templates || changes.state) void tick(shell);
  if (changes.active && !changes.active.newValue) {
    void stopVoice();
    void closePopup();
  }
});

chrome.notifications.onButtonClicked.addListener(async (id, button) => {
  const { active } = await kvGet();
  const d = active?.items.find((x) => x.occurrenceId === id);
  if (!d) return chrome.notifications.clear(id);
  await act(id, d.reminderId, button === 0 ? "done" : "snoozed", 5);
});
chrome.notifications.onClicked.addListener(async (id) => {
  const { active } = await kvGet();
  if (active?.items.some((x) => x.occurrenceId === id)) await showPopup();
  else void chrome.runtime.openOptionsPage();
  chrome.notifications.clear(id);
});
chrome.windows.onRemoved.addListener(async (id) => {
  const { popupWindowId } = (await chrome.storage.session.get("popupWindowId")) as { popupWindowId?: number };
  if (popupWindowId === id) await chrome.storage.session.remove("popupWindowId");
});

chrome.runtime.onMessage.addListener((msg: { type?: string; target?: string }, _sender, reply) => {
  if (msg.target === "offscreen") return false;
  if (msg.type === "test-voice") {
    void kvGet().then(({ settings }) =>
      settings
        ? playVoice(
            [
              {
                occurrenceId: "test",
                reminderId: "test",
                name: "Test",
                category: "walk",
                message: "This is your DeskWell test voice. Have a great day.",
                scheduledAt: nowIso(),
                delivery: "voice",
                voice: { mode: "pack", packId: "akib", profileId: null, audioIds: [], randomAudio: false, volume: 1 },
                language: settings.language,
                snoozeOptions: [],
                priority: "normal",
              },
            ],
            settings,
          )
        : undefined,
    );
    reply({ ok: true });
  }
  if (msg.type === "stop-voice") void stopVoice().then(() => reply({ ok: true }));
  if (msg.type === "tick") void tick(shell).then(() => reply({ ok: true }));
  return true;
});

// Service worker woke up for any reason: make sure the schedule is armed.
void ensureHeartbeat().then(() => tick(shell));
