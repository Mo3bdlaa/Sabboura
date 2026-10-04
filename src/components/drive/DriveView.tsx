"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FilePlus2,
  FolderInput,
  FolderPlus,
  LayoutGrid,
  List,
  MoreVertical,
  Pencil,
  RotateCcw,
  Star,
  StarOff,
  Trash2,
  XCircle,
} from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { Button, IconButton, Menu, type MenuItem } from "@/components/ui";
import type { Item } from "@/lib/backend";
import { ancestors, byId, cn, isEffectivelyTrashed, isWithin, sortItems, timeAgo } from "@/lib/utils";
import { FolderGlyph, useDrive } from "./DriveShell";

export type DriveViewKind = "folder" | "recent" | "starred" | "trash";

const DRAG_TYPE = "application/x-sabboura-item";

export function DriveView({ view, folderId = null }: { view: DriveViewKind; folderId?: string | null }) {
  const { items, itemsLoaded, actions, toast } = useApp();
  const drive = useDrive();
  const router = useRouter();
  const [sort, setSort] = useState<"name" | "updated">("updated");
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; item: Item } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null | undefined>(undefined);

  const { setCurrentFolderId } = drive;
  useEffect(() => {
    setCurrentFolderId(view === "folder" ? folderId : null);
  }, [view, folderId, setCurrentFolderId]);

  const map = useMemo(() => byId(items), [items]);
  const folder = folderId ? map.get(folderId) : undefined;
  const search = drive.search.trim().toLowerCase();

  const visible = useMemo(() => {
    const live = (i: Item) => !isEffectivelyTrashed(i, map);
    if (search) {
      return sortItems(
        items.filter((i) => live(i) && i.name.toLowerCase().includes(search)),
        sort,
      );
    }
    switch (view) {
      case "folder":
        return sortItems(
          items.filter((i) => i.parent_id === folderId && !i.trashed_at),
          sort,
        );
      case "recent":
        return items
          .filter((i) => i.kind === "board" && live(i))
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
          .slice(0, 40);
      case "starred":
        return sortItems(items.filter((i) => i.starred && live(i)), sort);
      case "trash":
        // Only top-level trashed items; their contents come back with them.
        return items
          .filter((i) => {
            const parent = i.parent_id ? map.get(i.parent_id) : undefined;
            return i.trashed_at && !(parent && isEffectivelyTrashed(parent, map));
          })
          .sort((a, b) => (b.trashed_at ?? "").localeCompare(a.trashed_at ?? ""));
    }
  }, [items, map, view, folderId, sort, search]);

  const folders = visible.filter((i) => i.kind === "folder");
  const boards = visible.filter((i) => i.kind === "board");
  const showLocation = view !== "folder" || !!search;

  const open = (item: Item) => {
    if (view === "trash" && !search) return;
    router.push(item.kind === "folder" ? `/folder/${item.id}` : `/board/${item.id}`);
  };

  async function trash(item: Item) {
    await actions.update(item.id, { trashed_at: new Date().toISOString() });
    toast(`“${item.name}” moved to trash`, {
      label: "Undo",
      run: () => actions.update(item.id, { trashed_at: null }),
    });
  }

  async function deleteForever(item: Item) {
    const ok = await drive.confirm({
      title: "Delete forever?",
      body: `“${item.name}”${item.kind === "folder" ? " and everything inside it" : ""} will be permanently deleted. This can't be undone.`,
      confirmLabel: "Delete forever",
    });
    if (ok) await actions.remove(item.id);
  }

  async function emptyTrash() {
    const ok = await drive.confirm({
      title: "Empty trash?",
      body: "Everything in the trash will be permanently deleted. This can't be undone.",
      confirmLabel: "Empty trash",
    });
    if (ok) for (const i of visible) await actions.remove(i.id);
  }

  async function rename(item: Item) {
    const name = await drive.prompt({ title: "Rename", initial: item.name, confirmLabel: "Rename" });
    if (name && name !== item.name) await actions.update(item.id, { name });
  }

  function menuItems(item: Item): (MenuItem | "divider")[] {
    if (item.trashed_at) {
      return [
        {
          label: "Restore",
          icon: <RotateCcw size={16} />,
          onSelect: () => actions.update(item.id, { trashed_at: null }),
        },
        {
          label: "Delete forever",
          icon: <XCircle size={16} />,
          danger: true,
          onSelect: () => deleteForever(item),
        },
      ];
    }
    return [
      { label: "Open", icon: <ChevronRight size={16} />, onSelect: () => open(item) },
      {
        label: "Open in new tab",
        icon: <ExternalLink size={16} />,
        hidden: item.kind !== "board",
        onSelect: () => window.open(`/board/${item.id}`, "_blank"),
      },
      "divider",
      { label: "Rename", icon: <Pencil size={16} />, onSelect: () => rename(item) },
      {
        label: "Make a copy",
        icon: <Copy size={16} />,
        hidden: item.kind !== "board",
        onSelect: async () => {
          const copy = await actions.duplicate(item);
          toast(`Created “${copy.name}”`);
        },
      },
      { label: "Move to…", icon: <FolderInput size={16} />, onSelect: () => drive.moveDialog(item) },
      {
        label: item.starred ? "Remove from starred" : "Add to starred",
        icon: item.starred ? <StarOff size={16} /> : <Star size={16} />,
        onSelect: () => actions.update(item.id, { starred: !item.starred }),
      },
      "divider",
      { label: "Move to trash", icon: <Trash2 size={16} />, danger: true, onSelect: () => trash(item) },
    ];
  }

  const openMenu = (item: Item, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "contextmenu") {
      setMenu({ item, at: { x: e.clientX, y: e.clientY } });
    } else {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setMenu({ item, at: { x: r.right - 192, y: r.bottom + 4 } });
    }
  };

  // ---- Drag & drop into folders / breadcrumbs ----
  const canDrag = view !== "trash" && !search;
  const dragProps = (item: Item) =>
    canDrag
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.setData(DRAG_TYPE, item.id);
            e.dataTransfer.effectAllowed = "move";
          },
        }
      : {};

  const dropProps = (targetId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropTarget(targetId);
    },
    onDragLeave: () => setDropTarget(undefined),
    onDrop: async (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(undefined);
      const id = e.dataTransfer.getData(DRAG_TYPE);
      const dragged = map.get(id);
      if (!dragged || dragged.parent_id === targetId || id === targetId) return;
      if (dragged.kind === "folder" && targetId && isWithin(targetId, dragged.id, map)) return;
      await actions.update(id, { parent_id: targetId });
      toast(`Moved “${dragged.name}” to ${targetId ? map.get(targetId)?.name : "My boards"}`);
    },
  });

  // ---- Header ----
  const title = search
    ? `Results for “${drive.search.trim()}”`
    : view === "recent"
      ? "Recent"
      : view === "starred"
        ? "Starred"
        : view === "trash"
          ? "Trash"
          : null;

  const path = view === "folder" ? ancestors(folderId, map) : [];

  if (view === "folder" && folderId && itemsLoaded && (!folder || isEffectivelyTrashed(folder, map))) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="text-lg font-medium">This folder doesn&apos;t exist anymore.</p>
        <Link href="/" className="text-sm text-accent hover:underline">
          Back to My boards
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="sticky top-0 z-10 flex min-h-16 flex-wrap items-center gap-2 bg-bg py-3 md:bg-surface">
        {title ? (
          <h1 className="text-xl font-medium md:text-2xl">{title}</h1>
        ) : (
          <nav className="flex min-w-0 flex-wrap items-center gap-0.5 text-xl font-medium md:text-2xl">
            <Link
              href="/"
              {...dropProps(null)}
              className={cn(
                "rounded-full px-3 py-1 transition hover:bg-surface-2",
                dropTarget === null && "bg-accent-soft ring-2 ring-accent",
              )}
            >
              My boards
            </Link>
            {path.map((p) => (
              <span key={p.id} className="flex min-w-0 items-center gap-0.5">
                <ChevronRight size={20} className="shrink-0 text-muted" />
                <Link
                  href={`/folder/${p.id}`}
                  {...dropProps(p.id)}
                  className={cn(
                    "truncate rounded-full px-3 py-1 transition hover:bg-surface-2",
                    dropTarget === p.id && "bg-accent-soft ring-2 ring-accent",
                  )}
                >
                  {p.name}
                </Link>
              </span>
            ))}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-1">
          {view === "trash" && !search && visible.length > 0 && (
            <Button onClick={emptyTrash} className="text-danger">
              Empty trash
            </Button>
          )}
          {view !== "recent" && view !== "trash" && (
            <IconButton
              label={sort === "name" ? "Sorted by name" : "Sorted by last edited"}
              onClick={() => setSort(sort === "name" ? "updated" : "name")}
              className="w-auto gap-1.5 px-2.5 text-sm"
            >
              <ArrowUpDown size={16} />
              <span className="hidden sm:inline">{sort === "name" ? "Name" : "Last edited"}</span>
            </IconButton>
          )}
          <IconButton
            label={drive.layout === "grid" ? "List layout" : "Grid layout"}
            onClick={() => drive.setLayout(drive.layout === "grid" ? "list" : "grid")}
          >
            {drive.layout === "grid" ? <List size={18} /> : <LayoutGrid size={18} />}
          </IconButton>
        </div>
      </div>

      {view === "trash" && !search && (
        <p className="mb-4 rounded-lg bg-surface-2 px-4 py-2.5 text-sm text-muted">
          Items in the trash stay here until you delete them forever.
        </p>
      )}

      {!itemsLoaded ? (
        <SkeletonGrid />
      ) : visible.length === 0 ? (
        <EmptyState view={view} searching={!!search} folderId={folderId} />
      ) : drive.layout === "list" ? (
        <ListLayout
          items={visible}
          map={map}
          showLocation={showLocation}
          open={open}
          openMenu={openMenu}
          dragProps={dragProps}
          dropProps={dropProps}
          dropTarget={dropTarget}
        />
      ) : (
        <div className="flex flex-col gap-8">
          {folders.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-medium text-muted">Folders</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                {folders.map((f) => (
                  <div
                    key={f.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => open(f)}
                    onKeyDown={(e) => e.key === "Enter" && open(f)}
                    onContextMenu={(e) => openMenu(f, e)}
                    {...dragProps(f)}
                    {...(canDrag ? dropProps(f.id) : {})}
                    className={cn(
                      "group flex h-14 cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface-2/60 pr-1 pl-4 text-sm font-medium transition hover:bg-surface-2",
                      dropTarget === f.id && "bg-accent-soft ring-2 ring-accent",
                    )}
                  >
                    <FolderGlyph size={22} />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    {f.starred && <Star size={14} className="shrink-0 fill-current text-muted" />}
                    <IconButton label="More actions" onClick={(e) => openMenu(f, e)}>
                      <MoreVertical size={18} />
                    </IconButton>
                  </div>
                ))}
              </div>
            </section>
          )}
          {boards.length > 0 && (
            <section>
              {folders.length > 0 && <h2 className="mb-3 text-sm font-medium text-muted">Boards</h2>}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                {boards.map((b) => (
                  <div
                    key={b.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => open(b)}
                    onKeyDown={(e) => e.key === "Enter" && open(b)}
                    onContextMenu={(e) => openMenu(b, e)}
                    {...dragProps(b)}
                    className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-line bg-surface transition hover:shadow-soft"
                  >
                    <div className="relative aspect-[16/10] overflow-hidden border-b border-line bg-surface-2">
                      {b.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={b.thumbnail}
                          alt=""
                          draggable={false}
                          className="thumb-img size-full object-contain p-3"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center text-xs text-muted">Empty board</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 py-2 pr-1 pl-3">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                          <span className="truncate">{b.name}</span>
                          {b.starred && <Star size={13} className="shrink-0 fill-current text-muted" />}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {showLocation && <Location item={b} map={map} />}
                          {b.trashed_at ? `Trashed ${timeAgo(b.trashed_at)}` : `Edited ${timeAgo(b.updated_at)}`}
                        </p>
                      </div>
                      <IconButton label="More actions" onClick={(e) => openMenu(b, e)}>
                        <MoreVertical size={18} />
                      </IconButton>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <Menu at={menu?.at ?? null} items={menu ? menuItems(menu.item) : []} onClose={() => setMenu(null)} />
    </div>
  );
}

function Location({ item, map }: { item: Item; map: Map<string, Item> }) {
  const parent = item.parent_id ? map.get(item.parent_id) : null;
  return <span>{parent ? parent.name : "My boards"} · </span>;
}

function ListLayout({
  items,
  map,
  showLocation,
  open,
  openMenu,
  dragProps,
  dropProps,
  dropTarget,
}: {
  items: Item[];
  map: Map<string, Item>;
  showLocation: boolean;
  open(i: Item): void;
  openMenu(i: Item, e: React.MouseEvent): void;
  dragProps(i: Item): object;
  dropProps(id: string): object;
  dropTarget: string | null | undefined;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="hidden grid-cols-[1fr_180px_160px_44px] gap-4 border-b border-line px-4 py-2 text-xs font-medium text-muted sm:grid">
        <span>Name</span>
        <span>{showLocation ? "Location" : "Kind"}</span>
        <span>Last edited</span>
        <span />
      </div>
      {items.map((i) => (
        <div
          key={i.id}
          role="button"
          tabIndex={0}
          onClick={() => open(i)}
          onKeyDown={(e) => e.key === "Enter" && open(i)}
          onContextMenu={(e) => openMenu(i, e)}
          {...dragProps(i)}
          {...(i.kind === "folder" && !i.trashed_at ? dropProps(i.id) : {})}
          className={cn(
            "grid cursor-pointer grid-cols-[1fr_44px] items-center gap-4 border-b border-line px-4 py-1.5 text-sm last:border-b-0 hover:bg-surface-2 sm:grid-cols-[1fr_180px_160px_44px]",
            dropTarget === i.id && "bg-accent-soft",
          )}
        >
          <span className="flex min-w-0 items-center gap-3">
            {i.kind === "folder" ? (
              <FolderGlyph size={20} />
            ) : (
              <span className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded border border-line bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {i.thumbnail && <img src={i.thumbnail} alt="" className="thumb-img size-full object-contain" />}
              </span>
            )}
            <span className="truncate font-medium">{i.name}</span>
            {i.starred && <Star size={13} className="shrink-0 fill-current text-muted" />}
          </span>
          <span className="hidden truncate text-muted sm:block">
            {showLocation
              ? i.parent_id
                ? map.get(i.parent_id)?.name
                : "My boards"
              : i.kind === "folder"
                ? "Folder"
                : "Board"}
          </span>
          <span className="hidden text-muted sm:block">
            {timeAgo(i.trashed_at ?? i.updated_at)}
          </span>
          <IconButton label="More actions" onClick={(e) => openMenu(i, e)}>
            <MoreVertical size={18} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ view, searching, folderId }: { view: DriveViewKind; searching: boolean; folderId: string | null }) {
  const drive = useDrive();
  if (searching) return <Empty title="No matches" body="Try a different name." />;
  if (view === "recent") return <Empty title="Nothing here yet" body="Boards you edit will show up here." />;
  if (view === "starred") return <Empty title="No starred items" body="Star boards and folders to find them fast." />;
  if (view === "trash") return <Empty title="Trash is empty" body="Items you delete will appear here." />;
  return (
    <Empty
      title={folderId ? "This folder is empty" : "Welcome to Sabboura"}
      body={folderId ? "Create a board or a folder to get started." : "Every file here is a live whiteboard. Open it on any device and watch it update in real time."}
    >
      <div className="mt-2 flex gap-2">
        <Button variant="primary" onClick={() => drive.newBoard(folderId)} className="flex items-center gap-2">
          <FilePlus2 size={16} /> New board
        </Button>
        <Button onClick={() => drive.newFolder(folderId)} className="flex items-center gap-2 ring-1 ring-line">
          <FolderPlus size={16} /> New folder
        </Button>
      </div>
    </Empty>
  );
}

function Empty({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-24 text-center">
      <svg width="120" height="80" viewBox="0 0 120 80" aria-hidden="true" className="mb-3 text-muted">
        <rect x="8" y="8" width="104" height="64" rx="10" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 5" opacity="0.5" />
        <path d="M30 50c10-18 22-18 30-6s20 10 30-10" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <p className="text-lg font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted">{body}</p>
      {children}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="aspect-[16/12] animate-pulse rounded-xl bg-surface-2" />
      ))}
    </div>
  );
}
