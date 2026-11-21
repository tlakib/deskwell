import { useEffect, useRef, useState } from "react";
import { Pencil, Play, Plus, Square, Trash2, Upload } from "lucide-react";
import {
  AUDIO_LIMITS,
  CATEGORIES,
  CATEGORY_META,
  LANGUAGE_TAGS,
  LANGUAGES,
  VOICE_PACKS,
  nowIso,
  sniffAudio,
  uuid,
  voiceMatchesLanguage,
  type Category,
  type Language,
  type MessageTemplate,
  type VoiceAsset,
  type VoiceDescriptor,
  type VoicePackId,
  type VoiceProfile,
} from "@deskwell/domain";
import { PageTitle } from "../Dashboard";
import { Button, Card, Field, Input, Select } from "../components/ui";
import { useAction, useApp } from "../store";
import { systemVoices } from "../voice";

export default function VoiceStudio() {
  return (
    <>
      <PageTitle title="Voice Studio" subtitle="Bundled voices, system voices, your own recordings and the message library." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Packs />
        <SystemVoices />
        <AudioLibrary />
        <CloudTts />
        <MessageLibrary />
      </div>
    </>
  );
}

function usePlaying() {
  const { player } = useApp();
  const [playing, setPlaying] = useState(player.playing);
  useEffect(() => {
    const off = player.onChange(setPlaying);
    return () => {
      off();
    };
  }, [player]);
  return playing;
}

function Packs() {
  const { player, snap } = useApp();
  const playing = usePlaying();
  const [cat, setCat] = useState<Category>("walk");
  const [lang, setLang] = useState<Language>("bn");
  if (!snap) return null;
  return (
    <Card title="Bundled voices" action={playing ? <Button size="sm" variant="ghost" onClick={() => player.stop()}><Square size={12} /> Stop</Button> : undefined}>
      <p className="mb-3 text-xs text-fg-muted">Recorded with ElevenLabs and shipped inside the app, so they work offline. Choose a voice per reminder in its editor.</p>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Field label="Reminder">
          <Select value={cat} onChange={(e) => setCat(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Language">
          <Select value={lang} onChange={(e) => setLang(e.target.value as Language)}>
            <option value="bn">Bangla</option>
            <option value="en">English</option>
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(VOICE_PACKS) as VoicePackId[]).map((id) => (
          <Button key={id} onClick={() => player.previewPack(id, cat, lang, snap.settings.masterVolume)}>
            <Play size={14} /> {VOICE_PACKS[id].label}
          </Button>
        ))}
      </div>
    </Card>
  );
}

function SystemVoices() {
  const { snap, backend, player } = useApp();
  const run = useAction();
  const [voices, setVoices] = useState<VoiceDescriptor[] | null>(null);
  const [text, setText] = useState("Time to stand up and take a short walk.");
  useEffect(() => {
    void systemVoices().then(setVoices);
  }, []);
  if (!snap) return null;
  const s = snap.settings;
  const prof = s.voiceProfiles.find((p) => p.id === s.defaultVoiceProfileId) ?? s.voiceProfiles[0];
  const saveProfile = (p: VoiceProfile) =>
    run(() => backend.saveSettings({ ...s, voiceProfiles: s.voiceProfiles.some((x) => x.id === p.id) ? s.voiceProfiles.map((x) => (x.id === p.id ? p : x)) : [...s.voiceProfiles, p], updatedAt: nowIso() }));
  const matching = (voices ?? []).filter((v) => !prof || voiceMatchesLanguage(v.lang, prof.language));

  return (
    <Card title="System voices (offline TTS)">
      <p className="mb-3 text-xs text-fg-muted">
        Uses the voices installed on this computer to read reminder messages. Voices are listed by name and language only; DeskWell doesn't guess gender.
        {voices && voices.length === 0 && " No system voices were found on this device."}
      </p>
      {prof && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Profile">
              <Select value={prof.id} onChange={(e) => run(() => backend.saveSettings({ ...s, defaultVoiceProfileId: e.target.value, updatedAt: nowIso() }))}>
                {s.voiceProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Language">
              <Select value={prof.language} onChange={(e) => saveProfile({ ...prof, language: e.target.value as Language, voiceName: null })}>
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_TAGS[l].label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Voice" hint={matching.length === 0 && voices?.length ? `No ${LANGUAGE_TAGS[prof.language].label} voice installed; the browser default will be used.` : undefined}>
            <Select value={prof.voiceName ?? ""} onChange={(e) => saveProfile({ ...prof, voiceName: e.target.value || null })}>
              <option value="">Automatic (first matching)</option>
              {matching.map((v) => (
                <option key={v.id} value={v.name}>
                  {v.name} ({v.lang}){v.offline ? "" : " – online"}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            {(["rate", "pitch", "volume"] as const).map((k) => (
              <Field key={k} label={`${k[0]!.toUpperCase()}${k.slice(1)} ${prof[k].toFixed(2)}`}>
                <input
                  className="w-full accent-[var(--color-accent)]"
                  type="range"
                  min={k === "rate" ? 0.5 : 0}
                  max={k === "volume" ? 1 : 2}
                  step={0.05}
                  defaultValue={prof[k]}
                  onMouseUp={(e) => saveProfile({ ...prof, [k]: Number((e.target as HTMLInputElement).value) })}
                  onKeyUp={(e) => saveProfile({ ...prof, [k]: Number((e.target as HTMLInputElement).value) })}
                />
              </Field>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={text} onChange={(e) => setText(e.target.value)} aria-label="Preview text" />
            <Button onClick={() => player.previewSpeech(text, prof.language, { voiceName: prof.voiceName, rate: prof.rate, pitch: prof.pitch, volume: prof.volume * s.masterVolume })}>
              <Play size={14} /> Preview
            </Button>
          </div>
          <Button size="sm" onClick={() => saveProfile({ id: uuid(), name: `Profile ${s.voiceProfiles.length + 1}`, language: "en", voiceName: null, provider: "system", rate: 1, pitch: 1, volume: 1 })}>
            <Plus size={14} /> New profile
          </Button>
        </div>
      )}
    </Card>
  );
}

function AudioLibrary() {
  const { backend, player, snap } = useApp();
  const run = useAction();
  const [list, setList] = useState<VoiceAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const reload = () => backend.listAudio().then(setList).catch(() => setList([]));
  useEffect(() => {
    void reload();
  }, [backend]);

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    setErr(null);
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        if (f.size > AUDIO_LIMITS.maxBytes) throw new Error(`${f.name} is larger than ${AUDIO_LIMITS.maxBytes / 1024 / 1024} MB.`);
        const head = new Uint8Array(await f.slice(0, 16).arrayBuffer());
        if (!sniffAudio(head)) throw new Error(`${f.name} is not a supported audio file (MP3, WAV, OGG, M4A, WebM).`);
        await backend.importAudio(f, f.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Audio", "General");
      }
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <Card
      title="My audio"
      action={
        <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
          <Upload size={14} /> {busy ? "Importing…" : "Upload"}
        </Button>
      }
    >
      <input ref={input} type="file" accept="audio/*" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
      <p className="mb-2 text-xs text-fg-muted">Your own recordings, stored only on this device (max {AUDIO_LIMITS.maxBytes / 1024 / 1024} MB each). Pick them in a reminder's voice setting.</p>
      {err && <p className="mb-2 text-xs text-danger" role="alert">{err}</p>}
      <ul className="divide-y divide-line">
        {list.map((a) => (
          <li key={a.id} className="flex items-center gap-2 py-2 text-sm">
            <span className="flex-1 truncate">{a.name}</span>
            <span className="text-xs text-fg-subtle">{(a.bytes / 1024).toFixed(0)} KB</span>
            <Button size="sm" variant="ghost" aria-label={`Play ${a.name}`} onClick={() => run(async () => player.previewBlob(await backend.readAudio(a.id), snap?.settings.masterVolume ?? 1))}>
              <Play size={14} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Rename ${a.name}`}
              onClick={() => {
                const name = window.prompt("New name", a.name)?.trim();
                if (name) void run(async () => { await backend.updateAudio(a.id, { name: name.slice(0, 120) }); await reload(); });
              }}
            >
              <Pencil size={14} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Delete ${a.name}`}
              onClick={() => window.confirm(`Delete "${a.name}"?`) && run(async () => { await backend.deleteAudio(a.id); await reload(); }, "Deleted")}
            >
              <Trash2 size={14} />
            </Button>
          </li>
        ))}
        {!list.length && <li className="py-2 text-sm text-fg-muted">No audio yet.</li>}
      </ul>
    </Card>
  );
}

function CloudTts() {
  return (
    <Card title="Cloud voices (optional)">
      <p className="text-sm text-fg-muted">
        <span className="mr-2 rounded bg-surface-3 px-1.5 py-0.5 text-[11px] font-medium text-fg">Not configured</span>
        DeskWell doesn't send anything to a cloud voice service. The app has a provider interface for adding one later with your own API key; none is enabled in this build, so there is nothing to set up here.
      </p>
    </Card>
  );
}

function MessageLibrary() {
  const { snap, backend } = useApp();
  const run = useAction();
  const [cat, setCat] = useState<Category>("walk");
  const [lang, setLang] = useState<Language>("en");
  const [text, setText] = useState("");
  if (!snap) return null;
  const items = snap.templates.filter((t) => t.category === cat && t.language === lang).sort((a, b) => a.order - b.order);
  const move = (t: MessageTemplate, dir: -1 | 1) => {
    const i = items.indexOf(t);
    const other = items[i + dir];
    if (!other) return;
    void run(async () => {
      await backend.saveTemplate({ ...t, order: other.order });
      await backend.saveTemplate({ ...other, order: t.order === other.order ? t.order + dir * -1 : t.order });
    });
  };
  return (
    <Card title="Message library" className="lg:col-span-2">
      <p className="mb-3 text-xs text-fg-muted">Reminders without their own messages pick from here (shown in the popup and read by system voices).</p>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:w-96">
        <Select aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value as Category)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_META[c].label}
            </option>
          ))}
        </Select>
        <Select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value as Language)}>
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {LANGUAGE_TAGS[l].label}
            </option>
          ))}
        </Select>
      </div>
      <ul className="space-y-1.5">
        {items.map((t, i) => (
          <li key={t.id} className="flex items-center gap-2">
            <Input defaultValue={t.text} maxLength={500} onBlur={(e) => e.target.value.trim() && e.target.value !== t.text && run(() => backend.saveTemplate({ ...t, text: e.target.value.trim() }), "Saved")} aria-label="Message text" />
            <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(t, -1)}>↑</Button>
            <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(t, 1)}>↓</Button>
            <Button size="sm" variant="ghost" aria-label="Delete message" onClick={() => run(() => backend.deleteTemplate(t.id), "Deleted")}>
              <Trash2 size={14} />
            </Button>
          </li>
        ))}
        {!items.length && <li className="text-sm text-fg-muted">No messages for this category and language.</li>}
      </ul>
      <div className="mt-3 flex gap-2">
        <Input placeholder="New message…" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
        <Button
          onClick={() =>
            text.trim() &&
            run(async () => {
              await backend.saveTemplate({ id: uuid(), category: cat, language: lang, text: text.trim(), order: (items.at(-1)?.order ?? 0) + 1, builtIn: false });
              setText("");
            }, "Added")
          }
        >
          <Plus size={14} /> Add
        </Button>
      </div>
    </Card>
  );
}
