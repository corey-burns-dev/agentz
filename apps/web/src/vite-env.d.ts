/// <reference types="vite/client" />

import type { NativeApi, DesktopBridge } from "@agents/contracts";

declare global {
  interface ImportMetaEnv {
    readonly VITE_NATIVE_API_DISABLED?: string;
    readonly VITE_WS_URL?: string;
  }

  interface Window {
    nativeApi?: NativeApi;
    desktopBridge?: DesktopBridge;
  }
}
