// Zip the built extension (dist/) into release/deskwell-extension-<version>.zip for the Chrome Web Store or "Load unpacked".
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import JSZip from "jszip";

const dist = new URL("../dist/", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
const zip = new JSZip();
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else zip.file(relative(dist, p).split("\\").join("/"), readFileSync(p));
  }
};
walk(dist);
const out = new URL("../release/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const file = join(out, `deskwell-extension-${manifest.version}.zip`);
writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
console.log(`wrote ${file}`);
