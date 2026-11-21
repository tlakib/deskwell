// Copies the bundled ElevenLabs voice packs (assets/voices) into an app's public folder.
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(process.cwd(), process.argv[2] ?? "public", "voices");
const src = join(root, "assets", "voices");
let n = 0;
for (const pack of readdirSync(src, { withFileTypes: true })) {
  if (!pack.isDirectory()) continue;
  mkdirSync(join(target, pack.name), { recursive: true });
  for (const f of readdirSync(join(src, pack.name))) {
    if (!f.endsWith(".mp3")) continue;
    cpSync(join(src, pack.name, f), join(target, pack.name, f));
    n++;
  }
}
console.log(`copied ${n} voice clips to ${target}`);
