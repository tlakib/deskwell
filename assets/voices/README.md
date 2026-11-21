# DeskWell voice packs

Studio-quality reminder voices bundled with DeskWell so voice reminders work offline with no API key.

| Pack | Voice | Languages | Files |
|---|---|---|---|
| `akib` | Akib (male), Md Ashik Ali's own cloned voice | Bengali, English | `akib/<category>-<lang>.mp3` |
| `rimjhim` | Rimjhim (female), ElevenLabs voice library | Bengali, English | `rimjhim/<category>-<lang>.mp3` |

Categories: walk, stand, water, eyes, stretch, rest, posture, breathing, meal, custom.
Each clip speaks the built-in message for that category (see `packages/domain/src/defaults.ts`).

Generated with ElevenLabs (`eleven_multilingual_v2`) on the author's ElevenLabs plan, November 2026.
These recordings are part of DeskWell and may be redistributed with it; please don't reuse the Akib voice
to create other content in the author's voice.
