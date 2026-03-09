/// <reference types="vite/client" />

import type { NativeApi, DesktopBridge } from "@agentz/contracts";

declare global {
	interface Window {
		nativeApi?: NativeApi;
		desktopBridge?: DesktopBridge;
	}
}
