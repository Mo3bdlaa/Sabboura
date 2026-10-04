import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type { Backend, Item, Peer, PointerPayload, Room, Scene, User } from "./types";

// Broadcast payloads above this size are dropped by Supabase Realtime;
// peers fall back to the saved copy in Postgres.
const MAX_BROADCAST_BYTES = 200_000;

const ITEM_COLUMNS = "id,parent_id,kind,name,starred,trashed_at,thumbnail,created_at,updated_at";

export function createSupabaseBackend(url: string, key: string): Backend {
  const sb: SupabaseClient = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const toUser = (u: { id: string; email?: string | null } | null | undefined): User | null =>
    u ? { id: u.id, email: u.email ?? null } : null;

  const must = <T>(res: { data: T; error: unknown }): T => {
    if (res.error) throw res.error;
    return res.data;
  };

  return {
    mode: "supabase",

    async getUser() {
      const { data } = await sb.auth.getSession();
      return toUser(data.session?.user);
    },

    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_event, session) => cb(toUser(session?.user)));
      return () => data.subscription.unsubscribe();
    },

    async signInWithPassword(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },

    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      return { needsConfirmation: !data.session };
    },

    async sendMagicLink(email) {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
    },

    async signOut() {
      await sb.auth.signOut();
    },

    async listItems() {
      return must(await sb.from("items").select(ITEM_COLUMNS).order("name")) as Item[];
    },

    async getItem(id) {
      return must(await sb.from("items").select(ITEM_COLUMNS).eq("id", id).maybeSingle()) as Item | null;
    },

    subscribeItems(cb) {
      const channel = sb
        .channel(`items-${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "items" }, (payload) => {
          if (payload.eventType === "DELETE") {
            cb({ deletedId: (payload.old as { id: string }).id });
          } else {
            const row = payload.new as Item & { owner_id?: string };
            delete row.owner_id;
            cb({ item: row });
          }
        })
        .subscribe();
      return () => {
        sb.removeChannel(channel);
      };
    },

    async createItem(input) {
      const item = must(
        await sb.from("items").insert(input).select(ITEM_COLUMNS).single(),
      ) as Item;
      if (input.kind === "board") {
        must(await sb.from("board_scenes").insert({ board_id: item.id }));
      }
      return item;
    },

    async updateItem(id, patch) {
      const full: Record<string, unknown> = { ...patch };
      // Renames/moves/stars count as edits; thumbnails are written alongside scene saves.
      full.updated_at = new Date().toISOString();
      must(await sb.from("items").update(full).eq("id", id));
    },

    async deleteItem(id) {
      must(await sb.from("items").delete().eq("id", id));
    },

    async getScene(boardId) {
      const row = must(
        await sb.from("board_scenes").select("elements,app_state,files").eq("board_id", boardId).maybeSingle(),
      ) as Scene | null;
      return row ?? { elements: [], app_state: {}, files: {} };
    },

    async saveScene(boardId, scene) {
      // Server-side merge by element version; see save_board_elements in supabase/migrations/20261004000000_init.sql.
      must(
        await sb.rpc("save_board_elements", {
          p_board_id: boardId,
          p_elements: scene.elements,
          p_app_state: scene.app_state,
        }),
      );
    },

    async saveFiles(boardId, files) {
      must(
        await sb
          .from("board_scenes")
          .update({ files, updated_at: new Date().toISOString() })
          .eq("board_id", boardId),
      );
    },

    joinBoard(boardId, me, handlers): Room {
      let channel: RealtimeChannel | null = null;
      let closed = false;

      const setup = async () => {
        // Private channels authorize with the user's JWT (see realtime.messages policies).
        const { data } = await sb.auth.getSession();
        if (data.session) await sb.realtime.setAuth(data.session.access_token);
        if (closed) return;

        channel = sb.channel(`board:${boardId}`, {
          config: { private: true, broadcast: { self: false }, presence: { key: me.clientId } },
        });

        channel
          .on("broadcast", { event: "elements" }, ({ payload }) => handlers.onElements(payload.elements))
          .on("broadcast", { event: "pointer" }, ({ payload }) =>
            handlers.onPointer(payload.clientId, payload.pointer as PointerPayload),
          )
          .on("broadcast", { event: "files" }, () => handlers.onFilesChanged())
          .on("presence", { event: "sync" }, () => {
            const state = channel!.presenceState<Peer>();
            const peers = Object.values(state)
              .map((metas) => metas[0])
              .filter((p): p is Peer & { presence_ref: string } => !!p && p.clientId !== me.clientId);
            handlers.onPeers(peers.map(({ clientId, name, color }) => ({ clientId, name, color })));
          })
          .on("presence", { event: "join" }, ({ newPresences }) => {
            for (const p of newPresences as unknown as Peer[]) {
              if (p.clientId !== me.clientId) handlers.onPeerJoined(p);
            }
          })
          .subscribe((status) => {
            if (status === "SUBSCRIBED") {
              handlers.onStatus("live");
              channel!.track(me);
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
              if (!closed) handlers.onStatus("offline");
            }
          });
      };

      handlers.onStatus("connecting");
      setup();

      const send = (event: string, payload: object) => {
        if (!channel || closed) return;
        channel.send({ type: "broadcast", event, payload });
      };

      return {
        sendElements(elements) {
          if (!elements.length) return;
          const payload = { elements };
          if (JSON.stringify(payload).length > MAX_BROADCAST_BYTES) {
            // Too big for one message: split into chunks.
            const chunk: unknown[] = [];
            let size = 0;
            for (const el of elements) {
              const s = JSON.stringify(el).length;
              if (size + s > MAX_BROADCAST_BYTES && chunk.length) {
                send("elements", { elements: chunk.splice(0) });
                size = 0;
              }
              if (s <= MAX_BROADCAST_BYTES) {
                chunk.push(el);
                size += s;
              }
            }
            if (chunk.length) send("elements", { elements: chunk });
            return;
          }
          send("elements", payload);
        },
        sendPointer(pointer) {
          send("pointer", { clientId: me.clientId, pointer });
        },
        notifyFilesChanged() {
          send("files", {});
        },
        leave() {
          closed = true;
          if (channel) sb.removeChannel(channel);
        },
      };
    },
  };
}
