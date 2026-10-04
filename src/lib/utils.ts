import type { Item } from "./backend/types";

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const PEER_COLORS = ["#e8590c", "#1971c2", "#2f9e44", "#9c36b5", "#c2255c", "#0c8599", "#f08c00", "#5f3dc4"];

export function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return PEER_COLORS[Math.abs(h) % PEER_COLORS.length];
}

/** Short human label for this device, e.g. "Chrome on Mac". */
export function deviceLabel() {
  if (typeof navigator === "undefined") return "Device";
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /iPad/.test(ua)
    ? "iPad"
    : /iPhone/.test(ua)
      ? "iPhone"
      : /Android/.test(ua)
        ? "Android"
        : /Mac/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  return os ? `${browser} on ${os}` : browser;
}

export function byId(items: Item[]) {
  return new Map(items.map((i) => [i.id, i]));
}

/** An item is hidden if it, or any ancestor, is in the trash. */
export function isEffectivelyTrashed(item: Item, map: Map<string, Item>) {
  let cur: Item | undefined = item;
  let guard = 0;
  while (cur && guard++ < 100) {
    if (cur.trashed_at) return true;
    cur = cur.parent_id ? map.get(cur.parent_id) : undefined;
  }
  return false;
}

export function ancestors(id: string | null, map: Map<string, Item>) {
  const path: Item[] = [];
  let cur = id ? map.get(id) : undefined;
  let guard = 0;
  while (cur && guard++ < 100) {
    path.unshift(cur);
    cur = cur.parent_id ? map.get(cur.parent_id) : undefined;
  }
  return path;
}

/** True if `id` is `ancestorId` or lives somewhere beneath it. */
export function isWithin(id: string | null, ancestorId: string, map: Map<string, Item>) {
  return ancestors(id, map).some((a) => a.id === ancestorId);
}

export function sortItems(items: Item[], sort: "name" | "updated") {
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    if (sort === "updated") return b.updated_at.localeCompare(a.updated_at);
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}
