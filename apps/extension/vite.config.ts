import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Multi-page MV3 build: popup, options (dashboard), reminder window, offscreen audio page and the service worker.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "",
  build: {
    target: "es2022",
    modulePreload: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
        options: resolve(__dirname, "options.html"),
        reminder: resolve(__dirname, "reminder.html"),
        offscreen: resolve(__dirname, "offscreen.html"),
        sw: resolve(__dirname, "src/sw.ts"),
      },
      output: {
        entryFileNames: (c) => (c.name === "sw" ? "sw.js" : "assets/[name]-[hash].js"),
      },
    },
  },
});
