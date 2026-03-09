import "./tauri-bridge";
import {
	createBrowserHistory,
	createHashHistory,
	RouterProvider,
} from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";

import "@xterm/xterm/css/xterm.css";
import "./index.css";

import { APP_DISPLAY_NAME } from "./branding";
import { isDesktopShell } from "./env";
import { getRouter } from "./router";
import { ready } from "./tauri-bridge";
import { setupZoom } from "./zoom";

setupZoom();

async function mount() {
	await ready;
	const history = isDesktopShell ? createHashHistory() : createBrowserHistory();
	const router = getRouter(history);
	document.title = APP_DISPLAY_NAME;
	ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
		<React.StrictMode>
			<RouterProvider router={router} />
		</React.StrictMode>,
	);
}

void mount();
