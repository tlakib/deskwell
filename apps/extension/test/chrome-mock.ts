import "fake-indexeddb/auto";

/** Minimal in-memory chrome.* used by the extension unit tests. */
type L = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void;
export function installChromeMock() {
  let local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const listeners: L[] = [];
  const area = (store: () => Record<string, unknown>, name: string) => ({
    async get(keys?: string | string[]) {
      const s = store();
      if (!keys) return structuredClone(s);
      const ks = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(ks.filter((k) => k in s).map((k) => [k, structuredClone(s[k])]));
    },
    async set(v: Record<string, unknown>) {
      const s = store();
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [k, val] of Object.entries(v)) {
        if (JSON.stringify(s[k]) === JSON.stringify(val)) continue;
        changes[k] = { oldValue: s[k], newValue: val };
        s[k] = structuredClone(val);
      }
      if (Object.keys(changes).length) for (const l of listeners) l(changes, name);
    },
    async remove(k: string) {
      delete store()[k];
    },
  });
  const notifications: { id: string; title: string }[] = [];
  (globalThis as Record<string, unknown>).chrome = {
    storage: { local: area(() => local, "local"), session: area(() => session, "session"), onChanged: { addListener: (l: L) => listeners.push(l), removeListener() {} } },
    notifications: { clear: async () => true, create: (id: string, o: { title: string }, cb: () => void) => (notifications.push({ id, title: o.title }), cb()) },
    runtime: { sendMessage: async () => undefined, getURL: (p: string) => `chrome-extension://x/${p}` },
    idle: { setDetectionInterval() {} },
  };
  return { reset: () => (local = {}), notifications };
}
