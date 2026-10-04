"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Clock,
  FilePlus2,
  FolderPlus,
  HardDrive,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Plus,
  Search,
  Star,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { Logo } from "@/components/Logo";
import { Button, Dialog, IconButton, Menu } from "@/components/ui";
import type { Item } from "@/lib/backend";
import { ancestors, byId, cn, isEffectivelyTrashed, isWithin } from "@/lib/utils";
import { RequireAuth } from "./RequireAuth";

interface PromptOpts {
  title: string;
  initial?: string;
  confirmLabel?: string;
}
interface ConfirmOpts {
  title: string;
  body: string;
  confirmLabel: string;
}

interface DriveCtx {
  search: string;
  setSearch(s: string): void;
  layout: "grid" | "list";
  setLayout(l: "grid" | "list"): void;
  currentFolderId: string | null;
  setCurrentFolderId(id: string | null): void;
  prompt(opts: PromptOpts): Promise<string | null>;
  confirm(opts: ConfirmOpts): Promise<boolean>;
  moveDialog(item: Item): void;
  newBoard(parentId: string | null): Promise<void>;
  newFolder(parentId: string | null): Promise<void>;
  importFile(parentId: string | null): void;
}

const Ctx = createContext<DriveCtx | null>(null);
export function useDrive() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDrive must be used inside <DriveShell>");
  return c;
}

export function DriveShell({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <Shell>{children}</Shell>
    </RequireAuth>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { backend, user, theme, setTheme, actions, toast } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const [layout, setLayoutState] = useState<"grid" | "list">(() => {
    try {
      return localStorage.getItem("sabboura:layout") === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null);
  const [accountMenu, setAccountMenu] = useState<{ x: number; y: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const importParent = useRef<string | null>(null);

  const [promptState, setPromptState] = useState<(PromptOpts & { resolve(v: string | null): void }) | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [confirmState, setConfirmState] = useState<(ConfirmOpts & { resolve(v: boolean): void }) | null>(null);
  const [moving, setMoving] = useState<Item | null>(null);

  // Navigating closes the mobile drawer and clears the search.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setDrawer(false);
    setSearch("");
  }

  const setLayout = useCallback((l: "grid" | "list") => {
    setLayoutState(l);
    try {
      localStorage.setItem("sabboura:layout", l);
    } catch {}
  }, []);

  const prompt = useCallback(
    (opts: PromptOpts) =>
      new Promise<string | null>((resolve) => {
        setPromptValue(opts.initial ?? "");
        setPromptState({ ...opts, resolve });
      }),
    [],
  );
  const confirm = useCallback(
    (opts: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirmState({ ...opts, resolve })),
    [],
  );

  const newBoard = useCallback(
    async (parentId: string | null) => {
      const item = await actions.create("board", "Untitled board", parentId);
      router.push(`/board/${item.id}`);
    },
    [actions, router],
  );

  const newFolder = useCallback(
    async (parentId: string | null) => {
      const name = await prompt({ title: "New folder", initial: "Untitled folder", confirmLabel: "Create" });
      if (name) await actions.create("folder", name, parentId);
    },
    [actions, prompt],
  );

  const importFile = useCallback((parentId: string | null) => {
    importParent.current = parentId;
    fileInput.current?.click();
  }, []);

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const { loadFromBlob } = await import("@excalidraw/excalidraw");
      const data = await loadFromBlob(file, null, null);
      const name = file.name.replace(/\.(excalidraw|json|png|svg)$/i, "") || "Imported board";
      const item = await actions.create("board", name, importParent.current);
      await backend.saveScene(item.id, {
        elements: [...data.elements],
        app_state: { viewBackgroundColor: data.appState.viewBackgroundColor },
      });
      if (data.files && Object.keys(data.files).length) await backend.saveFiles(item.id, data.files);
      router.push(`/board/${item.id}`);
    } catch (err) {
      console.error(err);
      toast("That file isn't a valid Excalidraw scene.");
    }
  }

  const openNewMenu = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    setNewMenu({ x: r.left, y: r.bottom + 6 });
  };

  const nav = [
    { href: "/", label: "My boards", icon: <HardDrive size={18} /> },
    { href: "/recent", label: "Recent", icon: <Clock size={18} /> },
    { href: "/starred", label: "Starred", icon: <Star size={18} /> },
    { href: "/trash", label: "Trash", icon: <Trash2 size={18} /> },
  ];
  const isActive = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/folder") : pathname === href);

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <Link href="/" className="mb-4 flex items-center gap-2.5 px-2 pt-1">
        <Logo />
        <span className="text-lg font-semibold tracking-tight">Sabboura</span>
      </Link>
      <button
        type="button"
        onClick={openNewMenu}
        className="mb-3 flex w-fit items-center gap-2 rounded-2xl bg-surface px-4 py-3 text-sm font-medium shadow-soft ring-1 ring-line transition hover:bg-surface-2"
      >
        <Plus size={18} /> New
      </button>
      {nav.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={cn(
            "flex items-center gap-3 rounded-full px-3.5 py-2 text-sm transition",
            isActive(n.href) ? "bg-accent-soft font-medium text-accent" : "text-ink hover:bg-surface-2",
          )}
        >
          {n.icon}
          {n.label}
        </Link>
      ))}
      <div className="mt-auto px-2 text-xs leading-relaxed text-muted">
        {backend.mode === "local" ? (
          <p>
            <span className="font-medium text-ink">Local mode.</span> Boards live in this browser and sync live
            between its tabs. Add Supabase keys to sync across devices.
          </p>
        ) : (
          <p className="truncate">Signed in as {user?.email}</p>
        )}
      </div>
    </nav>
  );

  const ctx: DriveCtx = {
    search,
    setSearch,
    layout,
    setLayout,
    currentFolderId,
    setCurrentFolderId,
    prompt,
    confirm,
    moveDialog: setMoving,
    newBoard,
    newFolder,
    importFile,
  };

  return (
    <Ctx.Provider value={ctx}>
      <div className="flex h-full">
        <aside className="hidden w-64 shrink-0 md:block">{sidebar}</aside>
        {drawer && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
            <aside className="absolute inset-y-0 left-0 w-72 bg-bg shadow-soft">{sidebar}</aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center gap-2 px-3 md:px-4">
            <IconButton label="Open menu" className="md:hidden" onClick={() => setDrawer(true)}>
              <MenuIcon size={20} />
            </IconButton>
            <label className="flex h-11 max-w-2xl flex-1 items-center gap-2 rounded-full bg-surface-2 px-4 text-sm focus-within:bg-surface focus-within:shadow-soft focus-within:ring-1 focus-within:ring-line">
              <Search size={18} className="shrink-0 text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search boards and folders"
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
              />
              {search && (
                <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="text-muted">
                  <X size={16} />
                </button>
              )}
            </label>
            <div className="ml-auto flex items-center gap-1">
              <IconButton
                label={theme === "dark" ? "Light theme" : "Dark theme"}
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              </IconButton>
              {backend.mode === "supabase" && (
                <button
                  type="button"
                  aria-label="Account"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setAccountMenu({ x: r.right - 200, y: r.bottom + 6 });
                  }}
                  className="ml-1 flex size-9 items-center justify-center rounded-full bg-accent text-sm font-semibold uppercase text-accent-ink"
                >
                  {user?.email?.[0] ?? "?"}
                </button>
              )}
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto px-3 pb-10 md:rounded-tl-2xl md:bg-surface md:px-6">
            {children}
          </main>
          <button
            type="button"
            aria-label="New"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setNewMenu({ x: r.right - 220, y: r.top - 8 });
            }}
            className="fixed right-5 bottom-6 z-40 flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-soft md:hidden"
          >
            <Plus size={24} />
          </button>
        </div>
      </div>

      <input ref={fileInput} type="file" accept=".excalidraw,.json,.png,.svg" hidden onChange={onImport} />

      <Menu
        at={newMenu}
        onClose={() => setNewMenu(null)}
        items={[
          { label: "New board", icon: <FilePlus2 size={16} />, onSelect: () => newBoard(currentFolderId) },
          { label: "New folder", icon: <FolderPlus size={16} />, onSelect: () => newFolder(currentFolderId) },
          "divider",
          { label: "Import .excalidraw file", icon: <Upload size={16} />, onSelect: () => importFile(currentFolderId) },
        ]}
      />
      <Menu
        at={accountMenu}
        onClose={() => setAccountMenu(null)}
        items={[
          {
            label: "Sign out",
            icon: <LogOut size={16} />,
            onSelect: async () => {
              await backend.signOut();
              router.replace("/login");
            },
          },
        ]}
      />

      <Dialog
        open={!!promptState}
        title={promptState?.title ?? ""}
        onClose={() => {
          promptState?.resolve(null);
          setPromptState(null);
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = promptValue.trim();
            promptState?.resolve(v || null);
            setPromptState(null);
          }}
        >
          <input
            autoFocus
            value={promptValue}
            onChange={(e) => setPromptValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <div className="mt-5 flex justify-end gap-2">
            <Button
              onClick={() => {
                promptState?.resolve(null);
                setPromptState(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!promptValue.trim()}>
              {promptState?.confirmLabel ?? "OK"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={!!confirmState}
        title={confirmState?.title ?? ""}
        onClose={() => {
          confirmState?.resolve(false);
          setConfirmState(null);
        }}
      >
        <p className="text-sm text-muted">{confirmState?.body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            onClick={() => {
              confirmState?.resolve(false);
              setConfirmState(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            autoFocus
            onClick={() => {
              confirmState?.resolve(true);
              setConfirmState(null);
            }}
          >
            {confirmState?.confirmLabel}
          </Button>
        </div>
      </Dialog>

      {moving && <MoveDialog key={moving.id} item={moving} onClose={() => setMoving(null)} />}
    </Ctx.Provider>
  );
}

function MoveDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const { items, actions, toast } = useApp();
  const [at, setAt] = useState<string | null>(item.parent_id);
  const map = byId(items);
  const folders = items
    .filter((i) => i.kind === "folder" && i.parent_id === at && !isEffectivelyTrashed(i, map))
    .sort((a, b) => a.name.localeCompare(b.name));
  const path = ancestors(at, map);
  const invalid = item.kind === "folder" && at !== null && isWithin(at, item.id, map);

  return (
    <Dialog open title={`Move “${item.name}”`} onClose={onClose}>
      <div className="mb-2 flex flex-wrap items-center gap-1 text-sm">
        <button type="button" className="rounded px-1.5 py-0.5 hover:bg-surface-2" onClick={() => setAt(null)}>
          My boards
        </button>
        {path.map((p) => (
          <span key={p.id} className="flex items-center gap-1">
            <span className="text-muted">/</span>
            <button type="button" className="rounded px-1.5 py-0.5 hover:bg-surface-2" onClick={() => setAt(p.id)}>
              {p.name}
            </button>
          </span>
        ))}
      </div>
      <div className="h-64 overflow-y-auto rounded-lg border border-line">
        {folders.length === 0 && <p className="p-4 text-sm text-muted">No folders here.</p>}
        {folders.map((f) => (
          <button
            key={f.id}
            type="button"
            disabled={f.id === item.id}
            onClick={() => setAt(f.id)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-40"
          >
            <FolderGlyph /> {f.name}
          </button>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={invalid || at === item.parent_id}
          onClick={async () => {
            await actions.update(item.id, { parent_id: at });
            toast(`Moved to ${at ? map.get(at)?.name : "My boards"}`);
            onClose();
          }}
        >
          Move here
        </Button>
      </div>
    </Dialog>
  );
}

export function FolderGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path
        d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.6a2 2 0 0 1 1.4.6L12 6h6.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"
        fill="var(--accent)"
        opacity="0.85"
      />
    </svg>
  );
}
