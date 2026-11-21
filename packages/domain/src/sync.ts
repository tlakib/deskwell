/**
 * Optional sync: provider interface and conflict rules. DeskWell works fully without any provider;
 * no provider ships enabled. See docs/DATA_MODEL.md "Sync rules".
 */

export interface Versioned {
  id: string;
  updatedAt: string;
  revision: number;
  deleted?: boolean;
}

export interface SyncProvider {
  id: string;
  label: string;
  isConfigured(): boolean;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  pull(since: string | null): Promise<{ records: Versioned[]; events: { id: string }[]; cursor: string }>;
  push(records: Versioned[], events: { id: string }[]): Promise<void>;
}

/**
 * Last-writer-wins by revision, then updatedAt, then id as a deterministic tiebreaker.
 * A record missing on one side is never treated as a deletion; deletions are explicit tombstones.
 */
export function resolveConflict<T extends Versioned>(local: T, remote: T): T {
  if (local.revision !== remote.revision) return local.revision > remote.revision ? local : remote;
  if (local.updatedAt !== remote.updatedAt) return local.updatedAt > remote.updatedAt ? local : remote;
  return local.id <= remote.id ? local : remote;
}

export function mergeRecords<T extends Versioned>(local: T[], remote: T[]): T[] {
  const map = new Map<string, T>();
  for (const r of local) map.set(r.id, r);
  for (const r of remote) {
    const l = map.get(r.id);
    map.set(r.id, l ? resolveConflict(l, r) : r);
  }
  return [...map.values()];
}

/** Append-only events merge idempotently by id. */
export function mergeEvents<E extends { id: string }>(local: E[], remote: E[]): E[] {
  const seen = new Map<string, E>();
  for (const e of local) seen.set(e.id, e);
  for (const e of remote) if (!seen.has(e.id)) seen.set(e.id, e);
  return [...seen.values()];
}
