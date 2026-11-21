import {
  LANGUAGE_TAGS,
  VOICE_PACKS,
  packClipPath,
  pickAudio,
  voiceMatchesLanguage,
  type Delivery,
  type Language,
  type Settings,
  type VoiceDescriptor,
  type VoicePackId,
} from "@deskwell/domain";
import type { Backend } from "./backend";

/** System (offline) TTS through the Web Speech API. Gender is never guessed: browsers don't report it. */
export function systemVoices(): Promise<VoiceDescriptor[]> {
  if (typeof speechSynthesis === "undefined") return Promise.resolve([]);
  const map = () =>
    speechSynthesis.getVoices().map((v) => ({
      id: v.voiceURI,
      name: v.name,
      lang: v.lang,
      provider: "system",
      gender: null,
      offline: v.localService,
    }));
  const now = map();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(map());
    speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
}

interface QueueItem {
  run: () => Promise<void>;
}

/**
 * Plays reminder audio one item at a time (never two reminders on top of each other) and can be
 * stopped immediately. Voice failures are swallowed: the popup still shows.
 */
export class VoicePlayer {
  private queue: QueueItem[] = [];
  private busy = false;
  private audio: HTMLAudioElement | null = null;
  private listeners = new Set<(playing: boolean) => void>();

  constructor(private backend: Backend) {}

  onChange(cb: (playing: boolean) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  get playing() {
    return this.busy;
  }

  private emit() {
    for (const l of this.listeners) l(this.busy);
  }

  stop() {
    this.queue = [];
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    this.busy = false;
    this.emit();
  }

  private enqueue(run: () => Promise<void>) {
    this.queue.push({ run });
    void this.pump();
  }

  private async pump() {
    if (this.busy) return;
    const next = this.queue.shift();
    if (!next) return;
    this.busy = true;
    this.emit();
    try {
      await next.run();
    } catch (e) {
      console.warn("DeskWell voice playback failed", e);
    }
    this.busy = false;
    this.emit();
    void this.pump();
  }

  playUrl(url: string, volume: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const a = new Audio(url);
      a.volume = Math.max(0, Math.min(1, volume));
      this.audio = a;
      a.onended = () => resolve();
      a.onerror = () => reject(new Error("audio error"));
      a.play().catch(reject);
    });
  }

  speak(text: string, lang: Language, opts: { voiceName: string | null; rate: number; pitch: number; volume: number }): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof speechSynthesis === "undefined") return reject(new Error("no speech synthesis"));
      const u = new SpeechSynthesisUtterance(text);
      u.lang = LANGUAGE_TAGS[lang].bcp47;
      const voices = speechSynthesis.getVoices();
      const v = (opts.voiceName && voices.find((x) => x.name === opts.voiceName)) || voices.find((x) => voiceMatchesLanguage(x.lang, lang));
      if (v) u.voice = v;
      u.rate = opts.rate;
      u.pitch = opts.pitch;
      u.volume = opts.volume;
      u.onend = () => resolve();
      u.onerror = (e) => (e.error === "interrupted" || e.error === "canceled" ? resolve() : reject(new Error(e.error)));
      speechSynthesis.speak(u);
    });
  }

  packUrl(pack: VoicePackId, category: string, lang: Language) {
    return `${this.backend.assetBase}${packClipPath(pack, category, lang)}`;
  }

  /** Play one delivery according to its voice choice. */
  playDelivery(d: Delivery, settings: Settings) {
    const master = settings.masterVolume;
    const v = d.voice;
    const profile = settings.voiceProfiles.find((p) => p.id === (v.profileId ?? settings.defaultVoiceProfileId)) ?? settings.voiceProfiles[0];
    const speak = () =>
      this.speak(d.message, d.language, {
        voiceName: profile?.voiceName ?? null,
        rate: profile?.rate ?? 1,
        pitch: profile?.pitch ?? 1,
        volume: (profile?.volume ?? 1) * v.volume * master,
      });
    if (v.mode === "none") return;
    this.enqueue(async () => {
      if (v.mode === "pack") {
        const pack = (v.packId in VOICE_PACKS ? v.packId : "akib") as VoicePackId;
        try {
          return await this.playUrl(this.packUrl(pack, d.category, d.language), v.volume * master);
        } catch {
          return speak();
        }
      }
      if (v.mode === "audio") {
        const assets = await this.backend.listAudio();
        const id = pickAudio({ voice: v } as never, new Set(assets.map((a) => a.id)));
        if (id) {
          const blob = await this.backend.readAudio(id);
          const url = URL.createObjectURL(blob);
          try {
            return await this.playUrl(url, v.volume * master);
          } catch {
            return speak();
          } finally {
            URL.revokeObjectURL(url);
          }
        }
      }
      return speak();
    });
  }

  previewPack(pack: VoicePackId, category: string, lang: Language, volume: number) {
    this.stop();
    this.enqueue(() => this.playUrl(this.packUrl(pack, category, lang), volume));
  }

  previewSpeech(text: string, lang: Language, opts: { voiceName: string | null; rate: number; pitch: number; volume: number }) {
    this.stop();
    this.enqueue(() => this.speak(text, lang, opts));
  }

  previewBlob(blob: Blob, volume: number) {
    this.stop();
    const url = URL.createObjectURL(blob);
    this.enqueue(() => this.playUrl(url, volume).finally(() => URL.revokeObjectURL(url)));
  }
}
