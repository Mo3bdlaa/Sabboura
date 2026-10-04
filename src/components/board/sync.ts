import {
  CaptureUpdateAction,
  exportToBlob,
  getNonDeletedElements,
  getSceneVersion,
  reconcileElements,
  restoreElements,
} from "@excalidraw/excalidraw";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  Collaborator,
  ExcalidrawImperativeAPI,
  SocketId,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { Backend, Peer, PointerPayload, Room, RoomStatus } from "@/lib/backend";

export type SaveState = "saved" | "unsaved" | "saving" | "error";

export interface SyncCallbacks {
  onSaveState(s: SaveState): void;
  onRoomStatus(s: RoomStatus): void;
  onPeers(p: Peer[]): void;
}

const SAVE_INTERVAL = 1000;
const SAVE_RETRY = 5000;
const THUMB_DELAY = 3000;
const BROADCAST_DELAY = 30;
const POINTER_INTERVAL = 40;
const DELETED_TTL = 24 * 60 * 60 * 1000;

/** Deleted elements are kept for a day so peers that were offline learn about the deletion. */
export function syncable(elements: readonly ExcalidrawElement[]) {
  const cutoff = Date.now() - DELETED_TTL;
  return elements.filter((e) => !e.isDeleted || e.updated > cutoff);
}

function blobToDataURL(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

type Timer = ReturnType<typeof setTimeout> | null;

/**
 * Keeps one Excalidraw canvas in sync with its peers and with storage.
 *
 * - Local edits are diffed by element version and broadcast as deltas.
 * - Remote deltas are merged with Excalidraw's `reconcileElements`.
 * - The tab that made an edit persists it (throttled) and refreshes the thumbnail.
 * - Images are stored once per board and announced to peers.
 */
export class BoardSync {
  private room: Room;
  private peers = new Map<string, Peer>();
  private collaborators = new Map<SocketId, Collaborator>();
  private lastSceneVersion = -1;
  private lastBg: string | undefined;
  private dirty = false;
  private saving = false;
  private destroyed = false;
  private everLive = false;
  private wasOffline = false;
  private pointerAt = 0;
  private collabFrame = 0;
  private saveTimer: Timer = null;
  private thumbTimer: Timer = null;
  private broadcastTimer: Timer = null;
  private filesTimer: Timer = null;

  constructor(
    private api: ExcalidrawImperativeAPI,
    private backend: Backend,
    private boardId: string,
    me: Peer,
    /** Highest element version every peer is known to have. */
    private known: Map<string, number>,
    private knownFiles: Set<string>,
    private cb: SyncCallbacks,
  ) {
    this.lastBg = api.getAppState().viewBackgroundColor;
    this.room = backend.joinBoard(boardId, me, {
      onElements: (els) => this.applyRemote(els),
      onPointer: (id, p) => this.onRemotePointer(id, p),
      onPeers: (list) => this.onPeers(list),
      onPeerJoined: () => this.room.sendElements(syncable(this.api.getSceneElementsIncludingDeleted())),
      onFilesChanged: () => this.fetchMissingFiles(),
      onStatus: (s) => this.onStatus(s),
    });
  }

  // ---------------------------------------------------------------- local --

  onChange(elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) {
    const v = getSceneVersion(elements);
    if (v !== this.lastSceneVersion) {
      this.lastSceneVersion = v;
      this.broadcastTimer ??= setTimeout(() => this.broadcastChanges(), BROADCAST_DELAY);
    }
    if (appState.viewBackgroundColor !== this.lastBg) {
      this.lastBg = appState.viewBackgroundColor;
      this.markDirty();
    }
    let newFiles = false;
    for (const id in files) {
      if (!this.knownFiles.has(id)) {
        this.knownFiles.add(id);
        newFiles = true;
      }
    }
    if (newFiles) this.filesTimer ??= setTimeout(() => this.saveFiles(), 200);
  }

  onPointerUpdate(pointer: { x: number; y: number; tool: "pointer" | "laser" }, button: "up" | "down") {
    const now = performance.now();
    if (now - this.pointerAt < POINTER_INTERVAL) return;
    this.pointerAt = now;
    this.room.sendPointer({
      ...pointer,
      button,
      selectedElementIds: this.api.getAppState().selectedElementIds as Record<string, true>,
    });
  }

  private broadcastChanges() {
    this.broadcastTimer = null;
    const changed = this.api
      .getSceneElementsIncludingDeleted()
      .filter((e) => (this.known.get(e.id) ?? -1) < e.version);
    if (!changed.length) return;
    for (const e of changed) this.known.set(e.id, e.version);
    this.room.sendElements(changed);
    this.markDirty();
  }

  // --------------------------------------------------------------- remote --

  private applyRemote(remoteElements: ExcalidrawElement[]) {
    if (this.destroyed) return;
    const remote = restoreElements(remoteElements, null) as RemoteExcalidrawElement[];
    const reconciled = reconcileElements(
      this.api.getSceneElementsIncludingDeleted(),
      remote,
      this.api.getAppState(),
    );
    for (const r of remote) this.known.set(r.id, Math.max(this.known.get(r.id) ?? -1, r.version));
    this.api.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER });

    const files = this.api.getFiles();
    if (remote.some((e) => e.type === "image" && e.fileId && !e.isDeleted && !files[e.fileId])) {
      this.fetchMissingFiles();
    }
  }

  private async fetchMissingFiles() {
    const scene = await this.backend.getScene(this.boardId);
    if (this.destroyed) return;
    const have = this.api.getFiles();
    const missing = Object.values(scene.files ?? {}).filter((f: BinaryFileData) => !have[f.id]);
    if (missing.length) {
      for (const f of missing) this.knownFiles.add(f.id);
      this.api.addFiles(missing);
    }
  }

  private onRemotePointer(clientId: string, p: PointerPayload) {
    const peer = this.peers.get(clientId);
    const id = clientId as SocketId;
    this.collaborators.set(id, {
      id: clientId,
      socketId: id,
      username: peer?.name ?? "Another device",
      color: { background: peer?.color ?? "#888", stroke: peer?.color ?? "#888" },
      pointer: { x: p.x, y: p.y, tool: p.tool },
      button: p.button,
      selectedElementIds: p.selectedElementIds,
    });
    this.pushCollaborators();
  }

  private onPeers(list: Peer[]) {
    this.peers = new Map(list.map((p) => [p.clientId, p]));
    for (const id of this.collaborators.keys()) {
      if (!this.peers.has(id)) this.collaborators.delete(id);
    }
    for (const p of list) {
      const id = p.clientId as SocketId;
      this.collaborators.set(id, {
        ...this.collaborators.get(id),
        id: p.clientId,
        socketId: id,
        username: p.name,
        color: { background: p.color, stroke: p.color },
      });
    }
    this.cb.onPeers(list);
    this.pushCollaborators();
  }

  private pushCollaborators() {
    if (this.collabFrame || this.destroyed) return;
    this.collabFrame = requestAnimationFrame(() => {
      this.collabFrame = 0;
      this.api.updateScene({ collaborators: new Map(this.collaborators) });
    });
  }

  private async onStatus(status: RoomStatus) {
    this.cb.onRoomStatus(status);
    if (status === "offline") this.wasOffline = true;
    if (status !== "live") return;
    if (this.everLive && this.wasOffline) {
      // Reconnected: catch up from storage, then share whatever we did offline.
      try {
        const scene = await this.backend.getScene(this.boardId);
        this.applyRemote(scene.elements ?? []);
        await this.fetchMissingFiles();
      } catch {}
      this.room.sendElements(syncable(this.api.getSceneElementsIncludingDeleted()));
    }
    this.everLive = true;
    this.wasOffline = false;
  }

  // --------------------------------------------------------------- saving --

  private markDirty() {
    this.dirty = true;
    this.cb.onSaveState("unsaved");
    this.saveTimer ??= setTimeout(() => this.save(), SAVE_INTERVAL);
  }

  private async save() {
    this.saveTimer = null;
    if (!this.dirty) return;
    if (this.saving) {
      this.saveTimer = setTimeout(() => this.save(), SAVE_INTERVAL);
      return;
    }
    this.dirty = false;
    this.saving = true;
    this.cb.onSaveState("saving");
    try {
      await this.backend.saveScene(this.boardId, {
        elements: syncable(this.api.getSceneElementsIncludingDeleted()),
        app_state: { viewBackgroundColor: this.api.getAppState().viewBackgroundColor },
      });
      this.cb.onSaveState(this.dirty ? "unsaved" : "saved");
      if (this.thumbTimer) clearTimeout(this.thumbTimer);
      this.thumbTimer = setTimeout(() => this.saveThumbnail(), THUMB_DELAY);
    } catch (err) {
      console.error("Sabboura: save failed", err);
      this.dirty = true;
      this.cb.onSaveState("error");
      this.saveTimer = setTimeout(() => this.save(), SAVE_RETRY);
    } finally {
      this.saving = false;
      if (this.dirty) this.saveTimer ??= setTimeout(() => this.save(), SAVE_INTERVAL);
    }
  }

  private async saveFiles() {
    this.filesTimer = null;
    try {
      await this.backend.saveFiles(this.boardId, this.api.getFiles());
      this.room.notifyFilesChanged();
    } catch (err) {
      console.error("Sabboura: saving images failed", err);
      this.cb.onSaveState("error");
    }
  }

  private async saveThumbnail() {
    this.thumbTimer = null;
    const elements = getNonDeletedElements(this.api.getSceneElements());
    try {
      if (!elements.length) {
        await this.backend.updateItem(this.boardId, { thumbnail: null });
        return;
      }
      const blob = await exportToBlob({
        elements,
        files: this.api.getFiles(),
        appState: { exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false },
        mimeType: "image/webp",
        quality: 0.7,
        exportPadding: 16,
        getDimensions: (w: number, h: number) => {
          const scale = Math.min(1, 480 / Math.max(w, h, 1));
          return { width: w * scale, height: h * scale, scale };
        },
      });
      await this.backend.updateItem(this.boardId, { thumbnail: await blobToDataURL(blob) });
    } catch (err) {
      console.warn("Sabboura: thumbnail failed", err);
    }
  }

  // ------------------------------------------------------------ lifecycle --

  get hasUnsavedChanges() {
    return this.dirty || this.saving || !!this.broadcastTimer;
  }

  /** Push out anything pending right now (tab hidden, navigating away). */
  flush() {
    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer);
      this.broadcastChanges();
    }
    if (this.filesTimer) {
      clearTimeout(this.filesTimer);
      this.saveFiles();
    }
    if (this.dirty) {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.save();
    }
    if (this.thumbTimer) {
      clearTimeout(this.thumbTimer);
      this.saveThumbnail();
    }
  }

  destroy() {
    this.flush();
    this.destroyed = true;
    if (this.collabFrame) cancelAnimationFrame(this.collabFrame);
    this.room.leave();
  }
}
