const DELETED_TTL = 24 * 60 * 60 * 1000;

interface Versioned {
  id: string;
  version: number;
  versionNonce: number;
  index?: string | null;
  isDeleted?: boolean;
  updated?: number;
}

/**
 * Merge two element lists by id: highest version wins, ties go to the lowest
 * versionNonce (Excalidraw's own rule). Mirrors save_board_elements in
 * supabase/migrations/20261004000000_init.sql so local mode behaves the same.
 */
export function mergeElements<T extends Versioned>(stored: readonly T[], incoming: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const el of [...stored, ...incoming]) {
    const cur = byId.get(el.id);
    if (
      !cur ||
      el.version > cur.version ||
      (el.version === cur.version && el.versionNonce < cur.versionNonce)
    ) {
      byId.set(el.id, el);
    }
  }
  const cutoff = Date.now() - DELETED_TTL;
  return [...byId.values()]
    .filter((e) => !(e.isDeleted && (e.updated ?? 0) < cutoff))
    .sort((a, b) => {
      const x = a.index ?? "￿";
      const y = b.index ?? "￿";
      return x < y ? -1 : x > y ? 1 : 0;
    });
}
