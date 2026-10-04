import { mergeElements } from "../merge";
import type { Backend, Item, Peer, Room, Scene, User } from "./types";

/**
 * Zero-config backend: data lives in this browser's localStorage and tabs
 * sync live over BroadcastChannel. Used when Supabase isn't configured.
 */

const ITEMS_KEY = "sabboura:items";
const sceneKey = (id: string) => `sabboura:scene:${id}`;
const LOCAL_USER: User = { id: "local", email: null };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error("Sabboura: local storage is full", err);
    throw new Error("Browser storage is full. Remove large images or connect Supabase.");
  }
}

export function createLocalBackend(): Backend {
  const itemsBus = new BroadcastChannel("sabboura:items");
  const listeners = new Set<(c: { item?: Item; deletedId?: string }) => void>();
  itemsBus.onmessage = (e) => listeners.forEach((l) => l(e.data));

  const emit = (change: { item?: Item; deletedId?: string }) => {
    listeners.forEach((l) => l(change));
    itemsBus.postMessage(change);
  };

  const all = () => read<Item[]>(ITEMS_KEY, []);
  const saveAll = (items: Item[]) => write(ITEMS_KEY, items);

  return {
    mode: "local",

    async getUser() {
      return LOCAL_USER;
    },
    onAuthChange() {
      return () => {};
    },
    async signInWithPassword() {},
    async signUp() {
      return { needsConfirmation: false };
    },
    async sendMagicLink() {},
    async signOut() {},

    async listItems() {
      return all();
    },

    async getItem(id) {
      return all().find((i) => i.id === id) ?? null;
    },

    subscribeItems(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    async createItem(input) {
      const now = new Date().toISOString();
      const item: Item = {
        id: crypto.randomUUID(),
        starred: false,
        trashed_at: null,
        thumbnail: null,
        created_at: now,
        updated_at: now,
        ...input,
      };
      saveAll([...all(), item]);
      if (item.kind === "board") write(sceneKey(item.id), { elements: [], app_state: {}, files: {} });
      emit({ item });
      return item;
    },

    async updateItem(id, patch) {
      const items = all();
      const idx = items.findIndex((i) => i.id === id);
      if (idx < 0) return;
      items[idx] = { ...items[idx], ...patch, updated_at: new Date().toISOString() };
      saveAll(items);
      emit({ item: items[idx] });
    },

    async deleteItem(id) {
      const items = all();
      const doomed = new Set([id]);
      // Cascade to descendants, mirroring the Postgres foreign key.
      let grew = true;
      while (grew) {
        grew = false;
        for (const i of items) {
          if (i.parent_id && doomed.has(i.parent_id) && !doomed.has(i.id)) {
            doomed.add(i.id);
            grew = true;
          }
        }
      }
      saveAll(items.filter((i) => !doomed.has(i.id)));
      doomed.forEach((d) => {
        localStorage.removeItem(sceneKey(d));
        emit({ deletedId: d });
      });
    },

    async getScene(boardId) {
      return read<Scene>(sceneKey(boardId), { elements: [], app_state: {}, files: {} });
    },

    async saveScene(boardId, scene) {
      const prev = read<Scene>(sceneKey(boardId), { elements: [], app_state: {}, files: {} });
      write(sceneKey(boardId), {
        ...prev,
        app_state: scene.app_state,
        elements: mergeElements(prev.elements ?? [], scene.elements),
      });
    },

    async saveFiles(boardId, files) {
      const prev = read<Scene>(sceneKey(boardId), { elements: [], app_state: {}, files: {} });
      write(sceneKey(boardId), { ...prev, files });
    },

    joinBoard(boardId, me, handlers): Room {
      const bus = new BroadcastChannel(`sabboura:board:${boardId}`);
      const peers = new Map<string, { peer: Peer; seen: number }>();

      const publishPeers = () => handlers.onPeers([...peers.values()].map((p) => p.peer));

      bus.onmessage = (e) => {
        const msg = e.data;
        switch (msg.type) {
          case "hello":
          case "here": {
            const isNew = !peers.has(msg.peer.clientId);
            peers.set(msg.peer.clientId, { peer: msg.peer, seen: Date.now() });
            if (isNew) {
              publishPeers();
              handlers.onPeerJoined(msg.peer);
            }
            if (msg.type === "hello") bus.postMessage({ type: "here", peer: me });
            break;
          }
          case "bye":
            peers.delete(msg.clientId);
            publishPeers();
            break;
          case "elements":
            handlers.onElements(msg.elements);
            break;
          case "pointer":
            handlers.onPointer(msg.clientId, msg.pointer);
            break;
          case "files":
            handlers.onFilesChanged();
            break;
        }
      };

      bus.postMessage({ type: "hello", peer: me });
      handlers.onStatus("live");

      // Heartbeat so crashed tabs eventually disappear.
      const heartbeat = setInterval(() => {
        bus.postMessage({ type: "here", peer: me });
        const cutoff = Date.now() - 6000;
        let changed = false;
        for (const [id, p] of peers) {
          if (p.seen < cutoff) {
            peers.delete(id);
            changed = true;
          }
        }
        if (changed) publishPeers();
      }, 2000);

      const bye = () => bus.postMessage({ type: "bye", clientId: me.clientId });
      window.addEventListener("pagehide", bye);

      return {
        sendElements(elements) {
          if (elements.length) bus.postMessage({ type: "elements", elements });
        },
        sendPointer(pointer) {
          bus.postMessage({ type: "pointer", clientId: me.clientId, pointer });
        },
        notifyFilesChanged() {
          bus.postMessage({ type: "files" });
        },
        leave() {
          clearInterval(heartbeat);
          window.removeEventListener("pagehide", bye);
          bye();
          bus.close();
        },
      };
    },
  };
}
