import type { EditorId } from "./editor";
import type {
	GitCheckoutInput,
	GitCreateBranchInput,
	GitCreateWorktreeInput,
	GitCreateWorktreeResult,
	GitInitInput,
	GitListBranchesInput,
	GitListBranchesResult,
	GitListIssuesInput,
	GitListIssuesResult,
	GitPullInput,
	GitPullResult,
	GitRemoveWorktreeInput,
	GitRunStackedActionInput,
	GitRunStackedActionResult,
	GitStatusInput,
	GitStatusResult,
} from "./git";
import type {
	ClientOrchestrationCommand,
	OrchestrationEvent,
	OrchestrationGetFullThreadDiffInput,
	OrchestrationGetFullThreadDiffResult,
	OrchestrationGetTurnDiffInput,
	OrchestrationGetTurnDiffResult,
	OrchestrationReadModel,
} from "./orchestration";
import type {
	ProjectSearchEntriesInput,
	ProjectSearchEntriesResult,
	ProjectWriteFileInput,
	ProjectWriteFileResult,
} from "./project";
import type {
	ServerConfig,
	ServerUpsertKeybindingInput,
	ServerUpsertKeybindingResult,
} from "./server";
import type {
	TerminalClearInput,
	TerminalCloseInput,
	TerminalEvent,
	TerminalOpenInput,
	TerminalResizeInput,
	TerminalSessionSnapshot,
	TerminalWriteInput,
} from "./terminal";

export interface ContextMenuItem<T extends string = string> {
	id: T;
	label: string;
	destructive?: boolean;
}

export type DesktopUpdateStatus =
	| "disabled"
	| "idle"
	| "checking"
	| "up-to-date"
	| "available"
	| "downloading"
	| "downloaded"
	| "error";

export interface DesktopUpdateState {
	enabled: boolean;
	status: DesktopUpdateStatus;
	currentVersion: string;
	availableVersion: string | null;
	downloadedVersion: string | null;
	downloadPercent: number | null;
	checkedAt: string | null;
	message: string | null;
	errorContext: "check" | "download" | "install" | null;
	canRetry: boolean;
}

export interface DesktopUpdateActionResult {
	accepted: boolean;
	completed: boolean;
	state: DesktopUpdateState;
}

export interface DesktopBridge {
	getWsUrl: () => string | null;
	pickFolder: () => Promise<string | null>;
	/** Returns absolute paths of immediate child directories. May return [] or throw if path is invalid or not readable. */
	listChildDirectories: (parentPath: string) => Promise<string[]>;
	confirm: (message: string) => Promise<boolean>;
	showContextMenu: <T extends string>(
		items: readonly ContextMenuItem<T>[],
		position?: { x: number; y: number },
	) => Promise<T | null>;
	openExternal: (url: string) => Promise<boolean>;
	onMenuAction: (listener: (action: string) => void) => () => void;
	getUpdateState: () => Promise<DesktopUpdateState>;
	downloadUpdate: () => Promise<DesktopUpdateActionResult>;
	installUpdate: () => Promise<DesktopUpdateActionResult>;
	onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
}

export interface NativeApi {
	dialogs: {
		pickFolder: () => Promise<string | null>;
		/** Returns absolute paths of immediate child directories. Returns [] when not in desktop shell or path invalid. */
		listChildDirectories: (parentPath: string) => Promise<string[]>;
		confirm: (message: string) => Promise<boolean>;
	};
	terminal: {
		open: (input: TerminalOpenInput) => Promise<TerminalSessionSnapshot>;
		write: (input: TerminalWriteInput) => Promise<void>;
		resize: (input: TerminalResizeInput) => Promise<void>;
		clear: (input: TerminalClearInput) => Promise<void>;
		restart: (input: TerminalOpenInput) => Promise<TerminalSessionSnapshot>;
		close: (input: TerminalCloseInput) => Promise<void>;
		onEvent: (callback: (event: TerminalEvent) => void) => () => void;
	};
	projects: {
		searchEntries: (
			input: ProjectSearchEntriesInput,
		) => Promise<ProjectSearchEntriesResult>;
		writeFile: (
			input: ProjectWriteFileInput,
		) => Promise<ProjectWriteFileResult>;
	};
	shell: {
		openInEditor: (cwd: string, editor: EditorId) => Promise<void>;
		openExternal: (url: string) => Promise<void>;
	};
	git: {
		// Existing branch/worktree API
		listBranches: (
			input: GitListBranchesInput,
		) => Promise<GitListBranchesResult>;
		createWorktree: (
			input: GitCreateWorktreeInput,
		) => Promise<GitCreateWorktreeResult>;
		removeWorktree: (input: GitRemoveWorktreeInput) => Promise<void>;
		createBranch: (input: GitCreateBranchInput) => Promise<void>;
		checkout: (input: GitCheckoutInput) => Promise<void>;
		init: (input: GitInitInput) => Promise<void>;
		// Stacked action API
		pull: (input: GitPullInput) => Promise<GitPullResult>;
		listIssues: (input: GitListIssuesInput) => Promise<GitListIssuesResult>;
		status: (input: GitStatusInput) => Promise<GitStatusResult>;
		runStackedAction: (
			input: GitRunStackedActionInput,
		) => Promise<GitRunStackedActionResult>;
	};
	contextMenu: {
		show: <T extends string>(
			items: readonly ContextMenuItem<T>[],
			position?: { x: number; y: number },
		) => Promise<T | null>;
	};
	server: {
		getConfig: () => Promise<ServerConfig>;
		upsertKeybinding: (
			input: ServerUpsertKeybindingInput,
		) => Promise<ServerUpsertKeybindingResult>;
	};
	orchestration: {
		getSnapshot: () => Promise<OrchestrationReadModel>;
		dispatchCommand: (
			command: ClientOrchestrationCommand,
		) => Promise<{ sequence: number }>;
		getTurnDiff: (
			input: OrchestrationGetTurnDiffInput,
		) => Promise<OrchestrationGetTurnDiffResult>;
		getFullThreadDiff: (
			input: OrchestrationGetFullThreadDiffInput,
		) => Promise<OrchestrationGetFullThreadDiffResult>;
		replayEvents: (
			fromSequenceExclusive: number,
		) => Promise<OrchestrationEvent[]>;
		onDomainEvent: (
			callback: (event: OrchestrationEvent) => void,
		) => () => void;
	};
}
