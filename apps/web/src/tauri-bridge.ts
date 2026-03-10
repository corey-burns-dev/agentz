/**
 * When running inside Tauri, expose window.desktopBridge using the Tauri invoke API.
 * Must run before any code that reads window.desktopBridge (e.g. env.ts).
 */
import type { DesktopBridge } from "@agents/contracts";

declare global {
  interface Window {
    __TAURI__?: {
      core: { invoke: <T>(cmd: string, args?: unknown) => Promise<T> };
      event: {
        listen: (name: string, handler: (payload: unknown) => void) => Promise<() => void>;
      };
    };
  }
}

let readyResolver!: () => void;
/** Resolves when get_ws_url has completed (so getWsUrl() returns the URL in Tauri). */
export const ready = new Promise<void>((r) => {
  readyResolver = r;
});

const tauri = typeof window !== "undefined" ? window.__TAURI__ : undefined;
if (tauri) {
  const { invoke } = tauri.core;
  const { listen } = tauri.event;
  let cachedWsUrl: string | null = null;

  const bridge: DesktopBridge = {
    getWsUrl: () => cachedWsUrl,
    pickFolder: () => invoke<string | null>("pick_folder"),
    listChildDirectories: (parentPath: string) =>
      invoke<string[]>("list_child_directories", { parentPath }),
    confirm: (message: string) => invoke<boolean>("confirm", { message }),
    showContextMenu: <T extends string>(
      items: readonly { id: T; label: string; destructive?: boolean }[],
      position?: { x: number; y: number },
    ) => invoke<T | null>("show_context_menu", { items, position }),
    openExternal: (url: string) => invoke<boolean>("open_external", { url }),
    onMenuAction: (listener: (action: string) => void) => {
      let unlisten: (() => void) | undefined;
      listen("menu-action", (event: unknown) => {
        const e = event as { payload?: unknown };
        const action = e?.payload;
        if (typeof action === "string") listener(action);
      }).then((fn) => {
        unlisten = fn;
      });
      return () => unlisten?.();
    },
    getUpdateState: () => invoke("get_update_state"),
    downloadUpdate: () => invoke("download_update"),
    installUpdate: () => invoke("install_update"),
    onUpdateState: (listener) => {
      let unlisten: (() => void) | undefined;
      listen("update-state", (event: unknown) => {
        const e = event as { payload?: unknown };
        const payload = e?.payload;
        if (payload && typeof payload === "object")
          listener(payload as Parameters<typeof listener>[0]);
      }).then((fn) => {
        unlisten = fn;
      });
      return () => unlisten?.();
    },
  };
  (window as Window & { desktopBridge: DesktopBridge }).desktopBridge = bridge;

  void invoke<string | null>("get_ws_url").then((url) => {
    cachedWsUrl = url;
    readyResolver();
  });
} else {
  readyResolver();
}
