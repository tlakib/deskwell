/** Random UUID v4 (uses Web Crypto, available in browsers, extension workers and Node 20+). */
export function uuid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
