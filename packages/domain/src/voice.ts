import type { Language } from "./types";

export interface VoiceDescriptor {
  id: string;
  name: string;
  lang: string;
  provider: string;
  /** Only set when the engine reports it. DeskWell never guesses a voice's gender. */
  gender: "female" | "male" | null;
  offline: boolean;
}

export interface TtsRequest {
  text: string;
  language: Language;
  voiceName: string | null;
  rate: number;
  pitch: number;
  volume: number;
}

export interface AudioResult {
  mime: string;
  data: Uint8Array;
}

export interface TtsProvider {
  id: string;
  label: string;
  supportsOffline: boolean;
  /** Can the provider produce audio files (for caching) or only speak live? */
  canGenerate: boolean;
  getVoices(): Promise<VoiceDescriptor[]>;
  preview(request: TtsRequest): Promise<AudioResult | void>;
  generate(request: TtsRequest): Promise<AudioResult>;
  stop(): void;
}

export const LANGUAGE_TAGS: Record<Language, { label: string; bcp47: string }> = {
  en: { label: "English", bcp47: "en" },
  bn: { label: "বাংলা (Bengali)", bcp47: "bn" },
  de: { label: "Deutsch (German)", bcp47: "de" },
};

export function voiceMatchesLanguage(voiceLang: string, lang: Language): boolean {
  return voiceLang.toLowerCase().replace("_", "-").startsWith(LANGUAGE_TAGS[lang].bcp47);
}

/** Stable cache key for generated audio: same text + voice settings = same file. */
export function ttsCacheKey(r: TtsRequest, provider: string): string {
  const norm = r.text.normalize("NFC").replace(/\s+/g, " ").trim();
  return [provider, r.language, r.voiceName ?? "default", r.rate.toFixed(2), r.pitch.toFixed(2), norm].join("|");
}

export const AUDIO_LIMITS = {
  maxBytes: 15 * 1024 * 1024,
  mimes: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/wave", "audio/ogg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/webm"],
  extensions: ["mp3", "wav", "ogg", "m4a", "aac", "webm"],
};

/** Sniff the audio container from the first bytes; returns a mime or null if not a supported audio file. */
export function sniffAudio(head: Uint8Array): string | null {
  const s = (o: number, str: string) => [...str].every((c, i) => head[o + i] === c.charCodeAt(0));
  if (s(0, "ID3") || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && (head[1] & 0x06) !== 0)) {
    // MPEG audio (ADTS AAC has layer bits 00; treated below)
    if ((head[1] & 0x06) === 0) return "audio/aac";
    return "audio/mpeg";
  }
  if (head[0] === 0xff && (head[1] & 0xf6) === 0xf0) return "audio/aac";
  if (s(0, "RIFF") && s(8, "WAVE")) return "audio/wav";
  if (s(0, "OggS")) return "audio/ogg";
  if (s(4, "ftyp")) return "audio/mp4";
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "audio/webm";
  return null;
}

/**
 * Bundled studio voice packs, pre-generated with ElevenLabs (no API key or internet needed at runtime).
 * Files live at assets/voices/<packId>/<category>-<lang>.mp3 and are copied into each app's build.
 * Each clip speaks the first built-in English/Bengali template for its category.
 */
export const VOICE_PACKS = {
  akib: { id: "akib", label: "Akib (male)", gender: "male" as const, languages: ["bn", "en"] as Language[] },
  rimjhim: { id: "rimjhim", label: "Rimjhim (female)", gender: "female" as const, languages: ["bn", "en"] as Language[] },
};
export type VoicePackId = keyof typeof VOICE_PACKS;

/** Relative URL of a pack clip, falling back to English when the language isn't in the pack. */
export function packClipPath(packId: VoicePackId, category: string, language: Language): string {
  const lang = VOICE_PACKS[packId].languages.includes(language) ? language : "en";
  return `voices/${packId}/${category}-${lang}.mp3`;
}
