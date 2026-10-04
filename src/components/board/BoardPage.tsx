"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CloudOff, Moon, Star, Sun } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { Logo } from "@/components/Logo";
import { RequireAuth } from "@/components/drive/RequireAuth";
import { IconButton } from "@/components/ui";
import type { Peer, RoomStatus, Scene } from "@/lib/backend";
import { ancestors, byId, cn, colorFor, deviceLabel, isEffectivelyTrashed } from "@/lib/utils";
import type { SaveState } from "./BoardEditor";

const BoardEditor = dynamic(() => import("./BoardEditor"), {
  ssr: false,
  loading: () => <CanvasLoading />,
});

export function BoardPage({ id }: { id: string }) {
  return (
    <RequireAuth>
      <Board key={id} id={id} />
    </RequireAuth>
  );
}

function CanvasLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="animate-pulse">
        <Logo size={40} />
      </div>
    </div>
  );
}

function Board({ id }: { id: string }) {
  const { backend, user, items, itemsLoaded, theme, setTheme, actions } = useApp();
  const router = useRouter();
  const [scene, setScene] = useState<Scene | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [roomStatus, setRoomStatus] = useState<RoomStatus>("connecting");
  const [peers, setPeers] = useState<Peer[]>([]);
  // Non-null only while the name field is being edited.
  const [draftTitle, setDraftTitle] = useState<string | null>(null);

  const map = useMemo(() => byId(items), [items]);
  const item = map.get(id);
  const path = item ? ancestors(item.parent_id, map) : [];
  const backHref = item?.parent_id ? `/folder/${item.parent_id}` : "/";

  // Stable identity for this tab in the room.
  const [clientId] = useState(() => crypto.randomUUID());
  const email = user?.email;
  const me = useMemo<Peer>(() => {
    const who = email ? email.split("@")[0] : "You";
    return { clientId, name: `${who} · ${deviceLabel()}`, color: colorFor(clientId) };
  }, [clientId, email]);

  useEffect(() => {
    let cancelled = false;
    backend
      .getScene(id)
      .then((s) => !cancelled && setScene(s))
      .catch((err) => {
        console.error(err);
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [backend, id]);

  useEffect(() => {
    if (item) document.title = `${item.name} · Sabboura`;
  }, [item]);

  const cancelTitle = useRef(false);
  const commitTitle = () => {
    const name = cancelTitle.current ? null : draftTitle?.trim();
    cancelTitle.current = false;
    setDraftTitle(null);
    if (item && name && name !== item.name) actions.update(item.id, { name });
  };

  if (itemsLoaded && (!item || item.kind !== "board" || isEffectivelyTrashed(item, map) || loadError)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-lg font-medium">
          {item && isEffectivelyTrashed(item, map) ? "This board is in the trash." : "Board not found."}
        </p>
        <Link href={item?.trashed_at ? "/trash" : "/"} className="text-sm text-accent hover:underline">
          {item?.trashed_at ? "Open trash" : "Back to My boards"}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-surface px-2">
        <IconButton label="Back to drive" onClick={() => router.push(backHref)}>
          <ArrowLeft size={18} />
        </IconButton>
        <Link href="/" className="hidden shrink-0 sm:block" aria-label="Sabboura home">
          <Logo size={24} />
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-1 pl-1">
          <nav className="hidden min-w-0 items-center gap-1 text-sm text-muted md:flex">
            <Link href="/" className="shrink-0 hover:text-ink">
              My boards
            </Link>
            {path.map((p) => (
              <span key={p.id} className="flex min-w-0 items-center gap-1">
                <span>/</span>
                <Link href={`/folder/${p.id}`} className="truncate hover:text-ink">
                  {p.name}
                </Link>
              </span>
            ))}
            <span>/</span>
          </nav>
          <input
            aria-label="Board name"
            value={draftTitle ?? item?.name ?? ""}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                cancelTitle.current = true;
                e.currentTarget.blur();
              }
            }}
            className="min-w-0 max-w-xs flex-1 truncate rounded-md px-1.5 py-1 text-sm font-medium outline-none hover:bg-surface-2 focus:bg-surface-2 focus:ring-1 focus:ring-accent"
          />
          {item && (
            <IconButton
              label={item.starred ? "Remove from starred" : "Add to starred"}
              onClick={() => actions.update(item.id, { starred: !item.starred })}
              className="size-8"
            >
              <Star size={16} className={cn(item.starred && "fill-current text-accent")} />
            </IconButton>
          )}
        </div>

        <StatusChip saveState={saveState} roomStatus={roomStatus} peers={peers} />
        <IconButton
          label={theme === "dark" ? "Light theme" : "Dark theme"}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </IconButton>
      </header>

      <div className="relative min-h-0 flex-1">
        {scene ? (
          <BoardEditor
            key={id}
            backend={backend}
            boardId={id}
            initialScene={scene}
            me={me}
            theme={theme}
            onSaveState={setSaveState}
            onRoomStatus={setRoomStatus}
            onPeers={setPeers}
            onBack={() => router.push(backHref)}
          />
        ) : (
          <CanvasLoading />
        )}
      </div>
    </div>
  );
}

function StatusChip({ saveState, roomStatus, peers }: { saveState: SaveState; roomStatus: RoomStatus; peers: Peer[] }) {
  const offline = roomStatus === "offline";
  const label =
    saveState === "error"
      ? "Not saved — retrying"
      : saveState === "saving" || saveState === "unsaved"
        ? "Saving…"
        : offline
          ? "Offline"
          : roomStatus === "connecting"
            ? "Connecting…"
            : peers.length
              ? `Live · ${peers.length + 1} open`
              : "Live · Saved";

  return (
    <div
      title={peers.length ? `Also open on: ${peers.map((p) => p.name).join(", ")}` : undefined}
      className={cn(
        "mr-1 flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        saveState === "error" || offline ? "bg-danger/10 text-danger" : "bg-surface-2 text-muted",
      )}
    >
      {offline ? (
        <CloudOff size={13} />
      ) : (
        <span
          className={cn(
            "size-2 rounded-full",
            roomStatus === "live" ? "bg-emerald-500" : "bg-amber-400",
            roomStatus === "live" && peers.length > 0 && "animate-pulse",
          )}
        />
      )}
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}
