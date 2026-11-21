import { pickAudio } from "@deskwell/domain";
import { listAudio, readAudio } from "./core";

/** Offscreen document: the only place a MV3 extension can play audio files in the background. */
let current: HTMLAudioElement | null = null;

function play(url: string, volume: number): Promise<boolean> {
  return new Promise((resolve) => {
    current?.pause();
    const a = new Audio(url);
    current = a;
    a.volume = Math.max(0, Math.min(1, volume));
    a.onended = () => resolve(true);
    a.onerror = () => resolve(false);
    a.onpause = () => resolve(true);
    a.play().catch(() => resolve(false));
  });
}

chrome.runtime.onMessage.addListener((msg: { target?: string; type: string; url?: string; ids?: string[]; random?: boolean; volume?: number }, _s, reply) => {
  if (msg.target !== "offscreen") return false;
  if (msg.type === "stop") {
    current?.pause();
    current = null;
    reply({ ok: true });
    return false;
  }
  void (async () => {
    try {
      if (msg.type === "play-url" && msg.url) return reply({ ok: await play(msg.url, msg.volume ?? 1) });
      if (msg.type === "play-audio") {
        const ids = new Set((await listAudio()).map((a) => a.id));
        const id = pickAudio({ voice: { audioIds: msg.ids ?? [], randomAudio: !!msg.random } } as never, ids);
        if (!id) return reply({ ok: false });
        const url = URL.createObjectURL(await readAudio(id));
        const ok = await play(url, msg.volume ?? 1);
        URL.revokeObjectURL(url);
        return reply({ ok });
      }
      reply({ ok: false });
    } catch {
      reply({ ok: false });
    }
  })();
  return true;
});
