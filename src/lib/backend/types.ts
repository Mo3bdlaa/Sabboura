export type ItemKind = "folder" | "board";

export interface Item {
  id: string;
  parent_id: string | null;
  kind: ItemKind;
  name: string;
  starred: boolean;
  trashed_at: string | null;
  thumbnail: string | null;
  created_at: string;
  updated_at: string;
}

export type ItemPatch = Partial<
  Pick<Item, "parent_id" | "name" | "starred" | "trashed_at" | "thumbnail">
>;

export interface User {
  id: string;
  email: string | null;
}

/** Excalidraw data, kept loosely typed at the storage boundary. */
export interface Scene {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  elements: any[];
  app_state: { viewBackgroundColor?: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  files: Record<string, any>;
}

export interface Peer {
  clientId: string;
  name: string;
  color: string;
}

export interface PointerPayload {
  x: number;
  y: number;
  tool: "pointer" | "laser";
  button: "up" | "down";
  selectedElementIds?: Record<string, true>;
}

export type RoomStatus = "connecting" | "live" | "offline";

export interface RoomHandlers {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onElements(elements: any[]): void;
  onPointer(clientId: string, pointer: PointerPayload): void;
  onPeers(peers: Peer[]): void;
  /** A new peer joined; send them anything they may not have yet. */
  onPeerJoined(peer: Peer): void;
  onFilesChanged(): void;
  onStatus(status: RoomStatus): void;
}

export interface Room {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendElements(elements: any[]): void;
  sendPointer(pointer: PointerPayload): void;
  notifyFilesChanged(): void;
  leave(): void;
}

export interface Backend {
  mode: "supabase" | "local";

  getUser(): Promise<User | null>;
  onAuthChange(cb: (user: User | null) => void): () => void;
  signInWithPassword(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  sendMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;

  listItems(): Promise<Item[]>;
  getItem(id: string): Promise<Item | null>;
  /** Fires with the changed row, or with `deletedId` when a row disappears. */
  subscribeItems(cb: (change: { item?: Item; deletedId?: string }) => void): () => void;
  createItem(input: { kind: ItemKind; name: string; parent_id: string | null }): Promise<Item>;
  updateItem(id: string, patch: ItemPatch): Promise<void>;
  deleteItem(id: string): Promise<void>;

  getScene(boardId: string): Promise<Scene>;
  saveScene(boardId: string, scene: Omit<Scene, "files">): Promise<void>;
  saveFiles(boardId: string, files: Scene["files"]): Promise<void>;

  joinBoard(boardId: string, me: Peer, handlers: RoomHandlers): Room;
}
