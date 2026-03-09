/**
 * True when running inside the desktop shell (Tauri) bridge, false in a regular browser.
 * The shell injects window.desktopBridge / window.nativeApi before any web-app
 * code executes, so this is reliable at module load time.
 */
export const isDesktopShell =
	typeof window !== "undefined" &&
	(window.desktopBridge !== undefined || window.nativeApi !== undefined);
