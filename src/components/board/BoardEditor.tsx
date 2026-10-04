"use client";

import "@excalidraw/excalidraw/index.css";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Excalidraw, MainMenu, WelcomeScreen, restoreElements } from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { ArrowLeft } from "lucide-react";
import type { Backend, Peer, RoomStatus, Scene } from "@/lib/backend";
import { BoardSync, type SaveState } from "./sync";

export type { SaveState };

export interface BoardEditorProps {
  backend: Backend;
  boardId: string;
  initialScene: Scene;
  me: Peer;
  theme: "light" | "dark";
  onSaveState(s: SaveState): void;
  onRoomStatus(s: RoomStatus): void;
  onPeers(p: Peer[]): void;
  onBack(): void;
}

export default function BoardEditor({
  backend,
  boardId,
  initialScene,
  me,
  theme,
  onSaveState,
  onRoomStatus,
  onPeers,
  onBack,
}: BoardEditorProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [collaborating, setCollaborating] = useState(false);
  const sync = useRef<BoardSync | null>(null);

  // Computed once: later updates arrive through the room, not props.
  const [init] = useState(() => {
    const elements = restoreElements(initialScene.elements ?? [], null);
    return {
      data: {
        elements,
        files: initialScene.files ?? {},
        appState: { viewBackgroundColor: initialScene.app_state?.viewBackgroundColor ?? "#ffffff" },
        scrollToContent: true,
      },
      known: new Map(elements.map((e) => [e.id, e.version])),
      knownFiles: new Set(Object.keys(initialScene.files ?? {})),
    };
  });

  const callbacks = useRef({ onSaveState, onRoomStatus, onPeers });
  useLayoutEffect(() => {
    callbacks.current = { onSaveState, onRoomStatus, onPeers };
  });

  useEffect(() => {
    if (!api) return;
    const s = new BoardSync(api, backend, boardId, me, init.known, init.knownFiles, {
      onSaveState: (x) => callbacks.current.onSaveState(x),
      onRoomStatus: (x) => callbacks.current.onRoomStatus(x),
      onPeers: (list) => {
        setCollaborating(list.length > 0);
        callbacks.current.onPeers(list);
      },
    });
    sync.current = s;

    const onVis = () => document.visibilityState === "hidden" && s.flush();
    const onUnload = (e: BeforeUnloadEvent) => {
      s.flush();
      if (s.hasUnsavedChanges) e.preventDefault();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("beforeunload", onUnload);
      s.destroy();
      sync.current = null;
    };
  }, [api, backend, boardId, me, init]);

  const onChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) =>
      sync.current?.onChange(elements, appState, files),
    [],
  );

  const onPointerUpdate = useCallback(
    (p: { pointer: { x: number; y: number; tool: "pointer" | "laser" }; button: "up" | "down" }) =>
      sync.current?.onPointerUpdate(p.pointer, p.button),
    [],
  );

  return (
    <div className="excalidraw-host absolute inset-0">
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={init.data}
        onChange={onChange}
        onPointerUpdate={onPointerUpdate}
        isCollaborating={collaborating}
        theme={theme}
        UIOptions={{ canvasActions: { toggleTheme: false, saveToActiveFile: false } }}
      >
        <MainMenu>
          <MainMenu.Item onSelect={onBack} icon={<ArrowLeft size={16} />}>
            Back to drive
          </MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
        <WelcomeScreen>
          <WelcomeScreen.Hints.MenuHint />
          <WelcomeScreen.Hints.ToolbarHint />
          <WelcomeScreen.Hints.HelpHint />
        </WelcomeScreen>
      </Excalidraw>
    </div>
  );
}
