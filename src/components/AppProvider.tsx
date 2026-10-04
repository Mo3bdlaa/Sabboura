"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getBackend, type Backend, type Item, type ItemPatch, type User } from "@/lib/backend";

type Theme = "light" | "dark";

interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

interface AppState {
  backend: Backend;
  /** undefined while the session is being restored. */
  user: User | null | undefined;
  items: Item[];
  itemsLoaded: boolean;
  theme: Theme;
  setTheme(t: Theme): void;
  toast(message: string, action?: Toast["action"]): void;
  actions: {
    create(kind: Item["kind"], name: string, parentId: string | null): Promise<Item>;
    update(id: string, patch: ItemPatch): Promise<void>;
    remove(id: string): Promise<void>;
    duplicate(item: Item): Promise<Item>;
  };
}

const Ctx = createContext<AppState | null>(null);

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

const noopSubscribe = () => () => {};

function subscribeTheme(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}
const readTheme = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

interface DriveState {
  userId: string | null;
  items: Item[];
  loaded: boolean;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  // Backend is browser-only (localStorage / websockets): null during SSR and hydration.
  const backend = useSyncExternalStore(noopSubscribe, getBackend, () => null);
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "light" as Theme);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [drive, setDrive] = useState<DriveState>({ userId: null, items: [], loaded: false });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  useEffect(() => {
    if (!backend) return;
    backend.getUser().then(setUser);
    return backend.onAuthChange(setUser);
  }, [backend]);

  const setTheme = useCallback((t: Theme) => {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("sabboura:theme", t);
    } catch {}
  }, []);

  const toast = useCallback((message: string, action?: Toast["action"]) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-2), { id, message, action }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 5000);
  }, []);

  // Load the whole drive once per user, then follow live changes.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!backend || !userId) return;
    let cancelled = false;
    const off = backend.subscribeItems(({ item, deletedId }) => {
      setDrive((d) => {
        if (d.userId !== userId) return d;
        if (deletedId) return { ...d, items: d.items.filter((i) => i.id !== deletedId) };
        if (!item) return d;
        const idx = d.items.findIndex((i) => i.id === item.id);
        const items = d.items.slice();
        if (idx < 0) items.push(item);
        else items[idx] = item;
        return { ...d, items };
      });
    });
    backend
      .listItems()
      .then((items) => !cancelled && setDrive({ userId, items, loaded: true }))
      .catch((err) => {
        console.error(err);
        toast("Couldn't load your drive. Check the Supabase setup.");
        if (!cancelled) setDrive({ userId, items: [], loaded: true });
      });
    return () => {
      cancelled = true;
      off();
    };
  }, [backend, userId, toast]);

  // Ignore data that belongs to a previous session.
  const current = drive.userId === userId;
  const items = useMemo(() => (current ? drive.items : []), [current, drive.items]);
  const itemsLoaded = current && drive.loaded;
  const setItems = useCallback(
    (fn: (cur: Item[]) => Item[]) => setDrive((d) => ({ ...d, items: fn(d.items) })),
    [],
  );

  const actions = useMemo<AppState["actions"]>(() => {
    const patchLocal = (id: string, patch: Partial<Item>) =>
      setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...patch } : i)));

    return {
      async create(kind, name, parentId) {
        const item = await backend!.createItem({ kind, name, parent_id: parentId });
        setItems((cur) => (cur.some((i) => i.id === item.id) ? cur : [...cur, item]));
        return item;
      },
      async update(id, patch) {
        patchLocal(id, { ...patch, updated_at: new Date().toISOString() });
        try {
          await backend!.updateItem(id, patch);
        } catch (err) {
          console.error(err);
          toast("Couldn't save that change.");
        }
      },
      async remove(id) {
        setItems((cur) => cur.filter((i) => i.id !== id && i.parent_id !== id));
        await backend!.deleteItem(id);
      },
      async duplicate(item) {
        const copy = await backend!.createItem({
          kind: item.kind,
          name: `${item.name} (copy)`,
          parent_id: item.parent_id,
        });
        if (item.kind === "board") {
          const scene = await backend!.getScene(item.id);
          await backend!.saveScene(copy.id, { elements: scene.elements, app_state: scene.app_state });
          if (Object.keys(scene.files).length) await backend!.saveFiles(copy.id, scene.files);
          if (item.thumbnail) await backend!.updateItem(copy.id, { thumbnail: item.thumbnail });
        }
        const full = { ...copy, thumbnail: item.thumbnail };
        setItems((cur) => [...cur.filter((i) => i.id !== copy.id), full]);
        return full;
      },
    };
  }, [backend, toast, setItems]);

  if (!backend) return <div className="h-full" />;

  return (
    <Ctx.Provider value={{ backend, user, items, itemsLoaded, theme, setTheme, toast, actions }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex items-center gap-4 rounded-lg bg-ink px-4 py-2.5 text-sm text-bg shadow-soft"
          >
            <span>{t.message}</span>
            {t.action && (
              <button
                className="font-semibold text-accent-soft hover:underline"
                onClick={() => {
                  t.action!.run();
                  setToasts((ts) => ts.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
