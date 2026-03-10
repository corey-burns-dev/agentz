import type {
	ApprovalRequestId,
	CodexReasoningEffort,
	ModelSlug,
	ProjectEntry,
	ProviderApprovalDecision,
	ProviderKind,
	ProviderUserInputAnswers,
} from "@agents/contracts";
import {
	getDefaultReasoningEffort,
	normalizeModelSlug,
} from "@agents/shared/model";
import {
	BotIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronUpIcon,
	CircleAlertIcon,
	ListTodoIcon,
	LockIcon,
	LockOpenIcon,
	Mic,
	XIcon,
	ZapIcon,
} from "lucide-react";
import {
	type DragEventHandler,
	type FormEventHandler,
	memo,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import { type AppServiceTier, shouldShowFastTierIcon } from "../appSettings";
import type {
	ComposerSlashCommand,
	ComposerTriggerKind,
} from "../composer-logic";
import type { ComposerImageAttachment } from "../composerDraftStore";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { cn } from "../lib/utils";
import {
	derivePendingUserInputProgress,
	type PendingUserInputDraftAnswer,
} from "../pendingUserInput";
import { proposedPlanTitle } from "../proposedPlan";
import type {
	derivePhase,
	PendingApproval,
	PendingUserInput,
	ProviderPickerKind,
} from "../session-logic";
import type { Thread } from "../types";
import {
	buildExpandedImagePreview,
	type ExpandedImagePreview,
} from "./ChatViewMessageList";
import {
	ComposerPromptEditor,
	type ComposerPromptEditorHandle,
} from "./ComposerPromptEditor";
import { ClaudeAI, Gemini, type Icon, OpenAI } from "./Icons";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Command, CommandItem, CommandList } from "./ui/command";
import {
	Menu,
	MenuSeparator as MenuDivider,
	MenuGroup,
	MenuItem,
	MenuPopup,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSub,
	MenuSubPopup,
	MenuSubTrigger,
	MenuTrigger,
} from "./ui/menu";
import { Separator } from "./ui/separator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export type ComposerCommandItem =
	| {
			id: string;
			type: "path";
			path: string;
			pathKind: ProjectEntry["kind"];
			label: string;
			description: string;
	  }
	| {
			id: string;
			type: "slash-command";
			command: ComposerSlashCommand;
			label: string;
			description: string;
	  }
	| {
			id: string;
			type: "model";
			provider: ProviderKind;
			model: ModelSlug;
			label: string;
			description: string;
			showFastBadge: boolean;
	  };

const ComposerCommandMenuItem = memo(function ComposerCommandMenuItem(props: {
	item: ComposerCommandItem;
	resolvedTheme: "light" | "dark";
	isActive: boolean;
	onSelect: (item: ComposerCommandItem) => void;
}) {
	return (
		<CommandItem
			value={props.item.id}
			className={cn(
				"cursor-pointer select-none gap-2",
				props.isActive && "bg-accent text-accent-foreground",
			)}
			onMouseDown={(event) => {
				event.preventDefault();
			}}
			onClick={() => {
				props.onSelect(props.item);
			}}
		>
			{props.item.type === "slash-command" ? (
				<BotIcon className="size-4 text-muted-foreground/80" />
			) : null}
			{props.item.type === "model" ? (
				<Badge variant="outline" className="px-1.5 py-0 text-2xs">
					model
				</Badge>
			) : null}
			<span className="flex min-w-0 items-center gap-1.5 truncate">
				{props.item.type === "model" && props.item.showFastBadge ? (
					<ZapIcon className="size-3.5 shrink-0 text-warning" />
				) : null}
				<span className="truncate">{props.item.label}</span>
			</span>
			<span className="truncate text-muted-foreground/70 text-xs">
				{props.item.description}
			</span>
		</CommandItem>
	);
});

const ComposerCommandMenu = memo(function ComposerCommandMenu(props: {
	items: ComposerCommandItem[];
	resolvedTheme: "light" | "dark";
	isLoading: boolean;
	triggerKind: ComposerTriggerKind | null;
	activeItemId: string | null;
	onHighlightedItemChange: (itemId: string | null) => void;
	onSelect: (item: ComposerCommandItem) => void;
}) {
	return (
		<Command
			mode="none"
			onItemHighlighted={(highlightedValue) => {
				props.onHighlightedItemChange(
					typeof highlightedValue === "string" ? highlightedValue : null,
				);
			}}
		>
			<div className="relative overflow-hidden rounded-xl border border-border/80 bg-popover/96 shadow-lg/8 backdrop-blur-xs">
				<CommandList className="max-h-64">
					{props.items.map((item) => (
						<ComposerCommandMenuItem
							key={item.id}
							item={item}
							resolvedTheme={props.resolvedTheme}
							isActive={props.activeItemId === item.id}
							onSelect={props.onSelect}
						/>
					))}
				</CommandList>
				{props.items.length === 0 && (
					<p className="px-3 py-2 text-muted-foreground/70 text-xs">
						{props.isLoading
							? "Searching workspace files..."
							: props.triggerKind === "path"
								? "No matching files or folders."
								: "No matching command."}
					</p>
				)}
			</div>
		</Command>
	);
});

const ComposerPendingApprovalPanel = memo(
	function ComposerPendingApprovalPanel({
		approval,
		pendingCount,
	}: {
		approval: PendingApproval;
		pendingCount: number;
	}) {
		const approvalSummary =
			approval.requestKind === "command"
				? "Command approval requested"
				: approval.requestKind === "file-read"
					? "File-read approval requested"
					: "File-change approval requested";

		return (
			<div className="px-4 py-3.5 sm:px-5 sm:py-4">
				<div className="flex flex-wrap items-center gap-2">
					<span className="uppercase text-sm tracking-[0.2em]">
						PENDING APPROVAL
					</span>
					<span className="text-sm font-medium">{approvalSummary}</span>
					{pendingCount > 1 ? (
						<span className="text-xs text-muted-foreground">
							1/{pendingCount}
						</span>
					) : null}
				</div>
			</div>
		);
	},
);

const ComposerPendingApprovalActions = memo(
	function ComposerPendingApprovalActions({
		requestId,
		isResponding,
		onRespondToApproval,
	}: {
		requestId: ApprovalRequestId;
		isResponding: boolean;
		onRespondToApproval: (
			requestId: ApprovalRequestId,
			decision: ProviderApprovalDecision,
		) => Promise<void>;
	}) {
		return (
			<>
				<Button
					size="sm"
					variant="ghost"
					disabled={isResponding}
					onClick={() => void onRespondToApproval(requestId, "cancel")}
				>
					Cancel turn
				</Button>
				<Button
					size="sm"
					variant="destructive-outline"
					disabled={isResponding}
					onClick={() => void onRespondToApproval(requestId, "decline")}
				>
					Decline
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={isResponding}
					onClick={() =>
						void onRespondToApproval(requestId, "acceptForSession")
					}
				>
					Always allow this session
				</Button>
				<Button
					size="sm"
					variant="default"
					disabled={isResponding}
					onClick={() => void onRespondToApproval(requestId, "accept")}
				>
					Approve once
				</Button>
			</>
		);
	},
);

const ComposerPendingUserInputPanel = memo(
	function ComposerPendingUserInputPanel({
		pendingUserInputs,
		respondingRequestIds,
		answers,
		questionIndex,
		onSelectOption,
		onAdvance,
	}: {
		pendingUserInputs: PendingUserInput[];
		respondingRequestIds: ApprovalRequestId[];
		answers: Record<string, PendingUserInputDraftAnswer>;
		questionIndex: number;
		onSelectOption: (questionId: string, optionLabel: string) => void;
		onAdvance: () => void;
	}) {
		if (pendingUserInputs.length === 0) return null;
		const activePrompt = pendingUserInputs[0];
		if (!activePrompt) return null;

		return (
			<ComposerPendingUserInputCard
				key={activePrompt.requestId}
				prompt={activePrompt}
				isResponding={respondingRequestIds.includes(activePrompt.requestId)}
				answers={answers}
				questionIndex={questionIndex}
				onSelectOption={onSelectOption}
				onAdvance={onAdvance}
			/>
		);
	},
);

const ComposerPendingUserInputCard = memo(
	function ComposerPendingUserInputCard({
		prompt,
		isResponding,
		answers,
		questionIndex,
		onSelectOption,
		onAdvance,
	}: {
		prompt: PendingUserInput;
		isResponding: boolean;
		answers: Record<string, PendingUserInputDraftAnswer>;
		questionIndex: number;
		onSelectOption: (questionId: string, optionLabel: string) => void;
		onAdvance: () => void;
	}) {
		const progress = derivePendingUserInputProgress(
			prompt.questions,
			answers,
			questionIndex,
		);
		const activeQuestion = progress.activeQuestion;
		const autoAdvanceTimerRef = useRef<number | null>(null);
		const onAdvanceRef = useRef(onAdvance);

		useEffect(() => {
			onAdvanceRef.current = onAdvance;
		}, [onAdvance]);

		// Clear auto-advance timer on unmount
		useEffect(() => {
			return () => {
				if (autoAdvanceTimerRef.current !== null) {
					window.clearTimeout(autoAdvanceTimerRef.current);
				}
			};
		}, []);

		const selectOptionAndAutoAdvance = useCallback(
			(questionId: string, optionLabel: string) => {
				onSelectOption(questionId, optionLabel);
				if (autoAdvanceTimerRef.current !== null) {
					window.clearTimeout(autoAdvanceTimerRef.current);
				}
				autoAdvanceTimerRef.current = window.setTimeout(() => {
					autoAdvanceTimerRef.current = null;
					onAdvanceRef.current?.();
				}, 200);
			},
			[onSelectOption],
		);

		// Keyboard shortcut: number keys 1-9 select corresponding option and auto-advance.
		useEffect(() => {
			if (!activeQuestion || isResponding) return;
			const handler = (event: globalThis.KeyboardEvent) => {
				if (event.metaKey || event.ctrlKey || event.altKey) return;
				const target = event.target;
				if (
					target instanceof HTMLInputElement ||
					target instanceof HTMLTextAreaElement
				) {
					return;
				}
				if (target instanceof HTMLElement && target.isContentEditable) {
					const hasCustomText = progress.customAnswer.length > 0;
					if (hasCustomText) return;
				}
				const digit = Number.parseInt(event.key, 10);
				if (Number.isNaN(digit) || digit < 1 || digit > 9) return;
				const optionIndex = digit - 1;
				if (optionIndex >= activeQuestion.options.length) return;
				const option = activeQuestion.options[optionIndex];
				if (!option) return;
				event.preventDefault();
				selectOptionAndAutoAdvance(activeQuestion.id, option.label);
			};
			document.addEventListener("keydown", handler);
			return () => document.removeEventListener("keydown", handler);
		}, [
			activeQuestion,
			isResponding,
			selectOptionAndAutoAdvance,
			progress.customAnswer.length,
		]);

		if (!activeQuestion) {
			return null;
		}

		return (
			<div className="px-4 py-3 sm:px-5">
				<div className="flex items-center gap-3">
					<div className="flex items-center gap-2">
						{prompt.questions.length > 1 ? (
							<span className="flex h-5 items-center rounded-md bg-muted/60 px-1.5 text-2xs font-medium tabular-nums text-muted-foreground/60">
								{questionIndex + 1}/{prompt.questions.length}
							</span>
						) : null}
						<span className="text-[11px] font-semibold tracking-widest text-muted-foreground/50 uppercase">
							{activeQuestion.header}
						</span>
					</div>
				</div>
				<p className="mt-1.5 text-sm text-foreground/90">
					{activeQuestion.question}
				</p>
				<div className="mt-3 space-y-1">
					{activeQuestion.options.map((option, index) => {
						const isSelected = progress.selectedOptionLabel === option.label;
						const shortcutKey = index < 9 ? index + 1 : null;
						return (
							<button
								key={`${activeQuestion.id}:${option.label}`}
								type="button"
								disabled={isResponding}
								onClick={() =>
									selectOptionAndAutoAdvance(activeQuestion.id, option.label)
								}
								className={cn(
									"group flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-all duration-150",
									isSelected
										? "border-primary/40 bg-primary/8 text-foreground"
										: "border-transparent bg-muted/20 text-foreground/80 hover:bg-muted/40 hover:border-border/40",
									isResponding && "opacity-50 cursor-not-allowed",
								)}
							>
								{shortcutKey !== null ? (
									<>
										<kbd
											className={cn(
												"flex size-5 shrink-0 items-center justify-center rounded text-[11px] font-medium tabular-nums transition-colors duration-150",
												isSelected
													? "bg-primary/20 text-primary"
													: "bg-muted/40 text-muted-foreground/50 group-hover:bg-muted/60 group-hover:text-muted-foreground/70",
											)}
										>
											{shortcutKey}
										</kbd>
										<span className="sr-only">
											Press {shortcutKey} to select
										</span>
									</>
								) : null}
								<div className="min-w-0 flex-1">
									<span className="text-sm font-medium">{option.label}</span>
									{option.description && option.description !== option.label ? (
										<span className="ml-2 text-xs text-muted-foreground/50">
											{option.description}
										</span>
									) : null}
								</div>
								{isSelected ? (
									<CheckIcon className="size-3.5 shrink-0 text-primary" />
								) : null}
							</button>
						);
					})}
				</div>
			</div>
		);
	},
);

const ComposerPlanFollowUpBanner = memo(function ComposerPlanFollowUpBanner({
	planTitle,
}: {
	planTitle: string | null;
}) {
	return (
		<div className="px-4 py-3.5 sm:px-5 sm:py-4">
			<div className="flex flex-wrap items-center gap-2">
				<span className="uppercase text-sm tracking-[0.2em]">Plan ready</span>
				{planTitle ? (
					<span className="min-w-0 flex-1 truncate text-sm font-medium">
						{planTitle}
					</span>
				) : null}
			</div>
		</div>
	);
});

const PROVIDER_ICON_BY_PROVIDER: Record<ProviderPickerKind, Icon> = {
	codex: OpenAI,
	"claude-code": ClaudeAI,
	gemini: Gemini,
};

function resolveModelForProviderPicker(
	provider: ProviderKind,
	value: string,
	options: ReadonlyArray<{ slug: string; name: string }>,
): ModelSlug | null {
	const trimmedValue = value.trim();
	if (!trimmedValue) {
		return null;
	}

	const direct = options.find((option) => option.slug === trimmedValue);
	if (direct) {
		return direct.slug;
	}

	const byName = options.find(
		(option) => option.name.toLowerCase() === trimmedValue.toLowerCase(),
	);
	if (byName) {
		return byName.slug;
	}

	const normalized = normalizeModelSlug(trimmedValue, provider);
	if (!normalized) {
		return null;
	}

	const resolved = options.find((option) => option.slug === normalized);
	if (resolved) {
		return resolved.slug;
	}

	return null;
}

export const ProviderModelPicker = memo(function ProviderModelPicker(props: {
	provider: ProviderKind;
	model: ModelSlug;
	lockedProvider: ProviderKind | null;
	modelOptionsByProvider: Record<
		ProviderKind,
		ReadonlyArray<{ slug: string; name: string }>
	>;
	availableProviders: ReadonlyArray<{
		value: ProviderPickerKind;
		label: string;
		available: true;
	}>;
	serviceTierSetting: AppServiceTier;
	disabled?: boolean;
	onProviderModelChange: (provider: ProviderKind, model: ModelSlug) => void;
}) {
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const selectedProviderOptions = props.modelOptionsByProvider[props.provider];
	const selectedModelLabel =
		selectedProviderOptions.find((option) => option.slug === props.model)
			?.name ?? props.model;
	const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[props.provider];

	return (
		<Menu
			open={isMenuOpen}
			onOpenChange={(open) => {
				if (props.disabled) {
					setIsMenuOpen(false);
					return;
				}
				setIsMenuOpen(open);
			}}
		>
			<MenuTrigger
				render={
					<Button
						size="sm"
						variant="ghost"
						className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
						disabled={props.disabled}
					/>
				}
			>
				<span className="flex min-w-0 items-center gap-2">
					<ProviderIcon
						aria-hidden="true"
						className="size-4 shrink-0 text-muted-foreground/70"
					/>
					{props.provider === "codex" &&
					shouldShowFastTierIcon(props.model, props.serviceTierSetting) ? (
						<ZapIcon className="size-3.5 shrink-0 text-warning" />
					) : null}
					<span className="truncate">{selectedModelLabel}</span>
					<ChevronUpIcon aria-hidden="true" className="size-3 opacity-60" />
				</span>
			</MenuTrigger>
			<MenuPopup align="start" side="top">
				{props.availableProviders.map((option) => {
					const OptionIcon = PROVIDER_ICON_BY_PROVIDER[option.value];
					const isDisabledByProviderLock =
						props.lockedProvider !== null &&
						props.lockedProvider !== option.value;
					return (
						<MenuSub key={option.value}>
							<MenuSubTrigger disabled={isDisabledByProviderLock}>
								<OptionIcon
									aria-hidden="true"
									className="size-4 shrink-0 text-muted-foreground/85"
								/>
								{option.label}
							</MenuSubTrigger>
							<MenuSubPopup className="[--available-height:min(24rem,70vh)]">
								<MenuGroup>
									<MenuRadioGroup
										value={props.provider === option.value ? props.model : ""}
										onValueChange={(value) => {
											if (props.disabled) return;
											if (isDisabledByProviderLock) return;
											if (!value) return;
											const resolvedModel = resolveModelForProviderPicker(
												option.value,
												value,
												props.modelOptionsByProvider[option.value],
											);
											if (!resolvedModel) return;
											props.onProviderModelChange(option.value, resolvedModel);
											setIsMenuOpen(false);
										}}
									>
										{props.modelOptionsByProvider[option.value].map(
											(modelOption) => (
												<MenuRadioItem
													key={`${option.value}:${modelOption.slug}`}
													value={modelOption.slug}
													onClick={() => setIsMenuOpen(false)}
												>
													{option.value === "codex" &&
													shouldShowFastTierIcon(
														modelOption.slug,
														props.serviceTierSetting,
													) ? (
														<ZapIcon className="size-3.5 shrink-0 text-warning" />
													) : null}
													{modelOption.name}
												</MenuRadioItem>
											),
										)}
									</MenuRadioGroup>
								</MenuGroup>
							</MenuSubPopup>
						</MenuSub>
					);
				})}
			</MenuPopup>
		</Menu>
	);
});

const CodexTraitsPicker = memo(function CodexTraitsPicker(props: {
	effort: CodexReasoningEffort;
	fastModeEnabled: boolean;
	options: ReadonlyArray<CodexReasoningEffort>;
	onEffortChange: (effort: CodexReasoningEffort) => void;
	onFastModeChange: (enabled: boolean) => void;
}) {
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const defaultReasoningEffort = getDefaultReasoningEffort("codex");
	const reasoningLabelByOption: Record<CodexReasoningEffort, string> = {
		low: "Low",
		medium: "Medium",
		high: "High",
		xhigh: "Extra High",
	};
	const triggerLabel = [
		reasoningLabelByOption[props.effort],
		...(props.fastModeEnabled ? ["Fast"] : []),
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<Menu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
			<MenuTrigger
				render={
					<Button
						size="sm"
						variant="ghost"
						className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
					/>
				}
			>
				<span>{triggerLabel}</span>
				<ChevronUpIcon aria-hidden="true" className="size-3 opacity-60" />
			</MenuTrigger>
			<MenuPopup align="start" side="top">
				<MenuGroup>
					<div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
						Reasoning
					</div>
					<MenuRadioGroup
						value={props.effort}
						onValueChange={(value) => {
							if (!value) return;
							const nextEffort = props.options.find(
								(option) => option === value,
							);
							if (!nextEffort) return;
							props.onEffortChange(nextEffort);
						}}
					>
						{props.options.map((effort) => (
							<MenuRadioItem key={effort} value={effort}>
								{reasoningLabelByOption[effort]}
								{effort === defaultReasoningEffort ? " (default)" : ""}
							</MenuRadioItem>
						))}
					</MenuRadioGroup>
				</MenuGroup>
				<MenuDivider />
				<MenuGroup>
					<div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
						Fast Mode
					</div>
					<MenuRadioGroup
						value={props.fastModeEnabled ? "on" : "off"}
						onValueChange={(value) => {
							props.onFastModeChange(value === "on");
						}}
					>
						<MenuRadioItem value="off">off</MenuRadioItem>
						<MenuRadioItem value="on">on</MenuRadioItem>
					</MenuRadioGroup>
				</MenuGroup>
			</MenuPopup>
		</Menu>
	);
});

export interface ComposerAreaProps {
	formRef: RefObject<HTMLFormElement | null>;
	onSubmit: FormEventHandler<HTMLFormElement>;
	isGitRepo: boolean;
	isDragOverComposer: boolean;
	onDragEnter: DragEventHandler<HTMLDivElement>;
	onDragOver: DragEventHandler<HTMLDivElement>;
	onDragLeave: DragEventHandler<HTMLDivElement>;
	onDrop: DragEventHandler<HTMLDivElement>;
	activePendingApproval: PendingApproval | null;
	pendingApprovalsCount: number;
	pendingUserInputs: PendingUserInput[];
	respondingUserInputRequestIds: ApprovalRequestId[];
	activePendingDraftAnswers: Record<string, PendingUserInputDraftAnswer>;
	activePendingQuestionIndex: number;
	onSelectActivePendingUserInputOption: (
		questionId: string,
		optionLabel: string,
	) => void;
	showPlanFollowUpPrompt: boolean;
	activeProposedPlan: Thread["proposedPlans"][number] | null;
	hasComposerHeader: boolean;
	composerMenuOpen: boolean;
	isComposerApprovalState: boolean;
	composerMenuItems: ComposerCommandItem[];
	resolvedTheme: "light" | "dark";
	isComposerMenuLoading: boolean;
	composerTriggerKind: ComposerTriggerKind | null;
	activeComposerMenuItemId: string | null;
	onComposerMenuItemHighlighted: (itemId: string | null) => void;
	onSelectComposerItem: (item: ComposerCommandItem) => void;
	composerImages: ComposerImageAttachment[];
	onExpandImage: (preview: ExpandedImagePreview) => void;
	nonPersistedComposerImageIdSet: ReadonlySet<string>;
	removeComposerImage: (imageId: string) => void;
	composerEditorRef: RefObject<ComposerPromptEditorHandle | null>;
	composerValue: string;
	composerCursor: number;
	onPromptChange: (
		nextValue: string,
		nextCursor: number,
		cursorAdjacentToMention: boolean,
	) => void;
	onComposerCommandKey: (
		key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab",
		event: KeyboardEvent,
	) => boolean;
	onComposerPaste: React.ClipboardEventHandler<HTMLElement>;
	placeholder: string;
	isConnecting: boolean;
	selectedProvider: ProviderKind;
	selectedModelForPickerWithCustomFallback: ModelSlug;
	lockedProvider: ProviderKind | null;
	modelOptionsByProvider: Record<
		ProviderKind,
		ReadonlyArray<{ slug: string; name: string }>
	>;
	availableProviders: ReadonlyArray<{
		value: ProviderPickerKind;
		label: string;
		available: true;
	}>;
	selectedServiceTierSetting: AppServiceTier;
	onProviderModelSelect: (provider: ProviderKind, model: ModelSlug) => void;
	selectedEffort: CodexReasoningEffort | null;
	selectedCodexFastModeEnabled: boolean;
	reasoningOptions: ReadonlyArray<CodexReasoningEffort>;
	onEffortSelect: (effort: CodexReasoningEffort) => void;
	onCodexFastModeChange: (enabled: boolean) => void;
	planModeSupported: boolean;
	interactionMode: "default" | "plan";
	toggleInteractionMode: () => void;
	runtimeMode: "approval-required" | "full-access";
	handleRuntimeModeChange: (mode: "approval-required" | "full-access") => void;
	isPreparingWorktree: boolean;
	activePendingProgress: {
		questionIndex: number;
		isLastQuestion: boolean;
		canAdvance: boolean;
		customAnswer: string;
	} | null;
	activePendingIsResponding: boolean;
	activePendingResolvedAnswers: ProviderUserInputAnswers | null;
	onPreviousActivePendingUserInputQuestion: () => void;
	phase: ReturnType<typeof derivePhase>;
	onInterrupt: () => Promise<void>;
	prompt: string;
	isSendBusy: boolean;
	onImplementPlanInNewThread: () => Promise<void>;
	respondingRequestIds: ApprovalRequestId[];
	onRespondToApproval: (
		requestId: ApprovalRequestId,
		decision: ProviderApprovalDecision,
	) => Promise<void>;
	planSidebarOpen: boolean;
	onTogglePlanSidebar: () => void;
	showPlanSidebarToggle: boolean;
	onAdvanceActivePendingUserInput: () => void;
	onAppendToPrompt?: (text: string) => void;
	isVoiceInputSupported?: boolean;
	/** Shown when user has switched provider on a finished thread (e.g. "Next message will use Claude Code"). */
	providerSwitchHint?: string | null;
}

export function ComposerArea(props: ComposerAreaProps) {
	const voiceSupported =
		props.isVoiceInputSupported === true && props.onAppendToPrompt != null;
	const voiceDisabled =
		!voiceSupported ||
		props.isConnecting ||
		props.isComposerApprovalState ||
		props.pendingUserInputs.length > 0;
	const speech = useSpeechRecognition({
		disabled: voiceDisabled,
		onFinalTranscript: props.onAppendToPrompt ?? (() => {}),
	});
	const toggleVoice = useCallback(() => {
		if (speech.status === "starting" || speech.status === "listening") {
			speech.stop();
		} else {
			speech.start();
		}
	}, [speech.start, speech.status, speech.stop]);

	return (
		<div
			className={cn(
				"shrink-0 px-3 pt-1.5 sm:px-5 sm:pt-2",
				props.isGitRepo ? "pb-1" : "pb-3 sm:pb-4",
			)}
		>
			<form
				ref={props.formRef}
				onSubmit={props.onSubmit}
				className="mx-auto w-full min-w-0 max-w-3xl"
				data-chat-composer-form="true"
			>
				<section
					aria-label="Message composer"
					className={`composer-density-shell group rounded-4xl border bg-card transition-colors duration-200 focus-within:border-ring/45 ${
						props.isDragOverComposer
							? "border-primary/70 bg-accent/30"
							: "border-border"
					}`}
					onDragEnter={props.onDragEnter}
					onDragOver={props.onDragOver}
					onDragLeave={props.onDragLeave}
					onDrop={props.onDrop}
				>
					{props.activePendingApproval ? (
						<div className="rounded-t-[19px] border-b border-border/65 bg-muted/20">
							<ComposerPendingApprovalPanel
								approval={props.activePendingApproval}
								pendingCount={props.pendingApprovalsCount}
							/>
						</div>
					) : props.pendingUserInputs.length > 0 ? (
						<div className="rounded-t-[19px] border-b border-border/65 bg-muted/20">
							<ComposerPendingUserInputPanel
								pendingUserInputs={props.pendingUserInputs}
								respondingRequestIds={props.respondingUserInputRequestIds}
								answers={props.activePendingDraftAnswers}
								questionIndex={props.activePendingQuestionIndex}
								onSelectOption={props.onSelectActivePendingUserInputOption}
								onAdvance={props.onAdvanceActivePendingUserInput}
							/>
						</div>
					) : props.showPlanFollowUpPrompt && props.activeProposedPlan ? (
						<div className="rounded-t-[19px] border-b border-border/65 bg-muted/20">
							<ComposerPlanFollowUpBanner
								key={props.activeProposedPlan.id}
								planTitle={
									proposedPlanTitle(props.activeProposedPlan.planMarkdown) ??
									null
								}
							/>
						</div>
					) : null}

					<div
						className={cn(
							"composer-density-padding relative px-3 pb-2 sm:px-4",
							props.hasComposerHeader ? "pt-2.5 sm:pt-3" : "pt-3.5 sm:pt-4",
						)}
					>
						{props.composerMenuOpen && !props.isComposerApprovalState && (
							<div className="absolute inset-x-0 bottom-full z-20 mb-2 px-1">
								<ComposerCommandMenu
									items={props.composerMenuItems}
									resolvedTheme={props.resolvedTheme}
									isLoading={props.isComposerMenuLoading}
									triggerKind={props.composerTriggerKind}
									activeItemId={props.activeComposerMenuItemId}
									onHighlightedItemChange={props.onComposerMenuItemHighlighted}
									onSelect={props.onSelectComposerItem}
								/>
							</div>
						)}

						{voiceSupported &&
						speech.isListening &&
						speech.interimTranscript ? (
							<div className="mb-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
								<span className="sr-only">Listening: </span>
								{speech.interimTranscript}
							</div>
						) : null}
						{voiceSupported && speech.error ? (
							<div className="mb-2 rounded-md border border-destructive/30 bg-destructive/8 px-2.5 py-1.5 text-xs text-destructive-foreground">
								{speech.error.message}
							</div>
						) : null}
						{!props.isComposerApprovalState &&
							props.pendingUserInputs.length === 0 &&
							props.composerImages.length > 0 && (
								<div className="mb-3 space-y-2">
									{props.selectedProvider === "claude-code" && (
										<div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
											<CircleAlertIcon className="size-3.5 shrink-0" />
											<span>
												Image attachments are not sent for Claude Code.
											</span>
										</div>
									)}
									<div className="flex flex-wrap gap-2">
										{props.composerImages.map((image) => (
											<div
												key={image.id}
												className="relative h-16 w-16 overflow-hidden rounded-lg border border-border/80 bg-background"
											>
												{image.previewUrl ? (
													<button
														type="button"
														className="h-full w-full cursor-zoom-in"
														aria-label={`Preview ${image.name}`}
														onClick={() => {
															const preview = buildExpandedImagePreview(
																props.composerImages,
																image.id,
															);
															if (!preview) return;
															props.onExpandImage(preview);
														}}
													>
														<img
															src={image.previewUrl}
															alt={image.name}
															className="h-full w-full object-cover"
														/>
													</button>
												) : (
													<div className="flex h-full w-full items-center justify-center px-1 text-center text-2xs text-muted-foreground/70">
														{image.name}
													</div>
												)}
												{props.nonPersistedComposerImageIdSet.has(image.id) && (
													<Tooltip>
														<TooltipTrigger
															render={
																<span
																	role="img"
																	aria-label="Draft attachment may not persist"
																	className="absolute left-1 top-1 inline-flex items-center justify-center rounded bg-background/85 p-0.5 text-warning"
																>
																	<CircleAlertIcon className="size-3" />
																</span>
															}
														/>
														<TooltipPopup
															side="top"
															className="max-w-64 whitespace-normal leading-tight"
														>
															Draft attachment could not be saved locally and
															may be lost on navigation.
														</TooltipPopup>
													</Tooltip>
												)}
												<Button
													variant="ghost"
													size="icon-xs"
													className="absolute right-1 top-1 bg-background/80 hover:bg-background/90"
													onClick={() => props.removeComposerImage(image.id)}
													aria-label={`Remove ${image.name}`}
												>
													<XIcon />
												</Button>
											</div>
										))}
									</div>
								</div>
							)}
						<ComposerPromptEditor
							ref={props.composerEditorRef}
							value={props.composerValue}
							cursor={props.composerCursor}
							onChange={props.onPromptChange}
							onCommandKeyDown={props.onComposerCommandKey}
							onPaste={props.onComposerPaste}
							placeholder={props.placeholder}
							disabled={props.isConnecting || props.isComposerApprovalState}
						/>
					</div>

					{props.activePendingApproval ? (
						<div className="flex items-center justify-end gap-2 px-2.5 pb-2.5 sm:px-3 sm:pb-3">
							<ComposerPendingApprovalActions
								requestId={props.activePendingApproval.requestId}
								isResponding={props.respondingRequestIds.includes(
									props.activePendingApproval.requestId,
								)}
								onRespondToApproval={props.onRespondToApproval}
							/>
						</div>
					) : (
						<div className="composer-density-toolbar flex flex-wrap items-center justify-between gap-2 px-2.5 pb-2.5 sm:flex-nowrap sm:gap-0 sm:px-3 sm:pb-3">
							<div className="chrome-density-toolbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:min-w-max sm:overflow-visible">
								<ProviderModelPicker
									provider={props.selectedProvider}
									model={props.selectedModelForPickerWithCustomFallback}
									lockedProvider={props.lockedProvider}
									modelOptionsByProvider={props.modelOptionsByProvider}
									availableProviders={props.availableProviders}
									serviceTierSetting={props.selectedServiceTierSetting}
									onProviderModelChange={props.onProviderModelSelect}
								/>
								{props.providerSwitchHint ? (
									<span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
										{props.providerSwitchHint}
									</span>
								) : null}

								{props.selectedProvider === "codex" &&
								props.selectedEffort != null ? (
									<>
										<Separator
											orientation="vertical"
											className="mx-0.5 hidden h-4 sm:block"
										/>
										<CodexTraitsPicker
											effort={props.selectedEffort}
											fastModeEnabled={props.selectedCodexFastModeEnabled}
											options={props.reasoningOptions}
											onEffortChange={props.onEffortSelect}
											onFastModeChange={props.onCodexFastModeChange}
										/>
									</>
								) : null}

								{props.planModeSupported ? (
									<>
										<Separator
											orientation="vertical"
											className="mx-0.5 hidden h-4 sm:block"
										/>
										<Button
											variant="ghost"
											className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
											size="sm"
											type="button"
											onClick={props.toggleInteractionMode}
											title={
												props.interactionMode === "plan"
													? "Plan mode — click to return to normal chat mode"
													: "Default mode — click to enter plan mode"
											}
										>
											<BotIcon />
											<span className="sr-only sm:not-sr-only">
												{props.interactionMode === "plan" ? "Plan" : "Chat"}
											</span>
										</Button>
										<Separator
											orientation="vertical"
											className="mx-0.5 hidden h-4 sm:block"
										/>
									</>
								) : null}

								<Button
									variant="ghost"
									className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
									size="sm"
									type="button"
									onClick={() =>
										void props.handleRuntimeModeChange(
											props.runtimeMode === "full-access"
												? "approval-required"
												: "full-access",
										)
									}
									title={
										props.runtimeMode === "full-access"
											? "Full access — click to require approvals"
											: "Approval required — click for full access"
									}
								>
									{props.runtimeMode === "full-access" ? (
										<LockOpenIcon />
									) : (
										<LockIcon />
									)}
									<span className="sr-only sm:not-sr-only">
										{props.runtimeMode === "full-access"
											? "Full access"
											: "Supervised"}
									</span>
								</Button>

								{props.showPlanSidebarToggle ? (
									<>
										<Separator
											orientation="vertical"
											className="mx-0.5 hidden h-4 sm:block"
										/>
										<Button
											variant="ghost"
											className={cn(
												"shrink-0 whitespace-nowrap px-2 sm:px-3",
												props.planSidebarOpen
													? "text-primary hover:text-primary/80"
													: "text-muted-foreground/70 hover:text-foreground/80",
											)}
											size="sm"
											type="button"
											onClick={props.onTogglePlanSidebar}
											title={
												props.planSidebarOpen
													? "Hide plan sidebar"
													: "Show plan sidebar"
											}
										>
											<ListTodoIcon />
											<span className="sr-only sm:not-sr-only">Plan</span>
										</Button>
									</>
								) : null}

								{voiceSupported ? (
									<>
										<Separator
											orientation="vertical"
											className="mx-0.5 hidden h-4 sm:block"
										/>
										<Tooltip>
											<TooltipTrigger
												render={
													<Button
														variant="ghost"
														size="sm"
														type="button"
														className={cn(
															"shrink-0 px-2 sm:px-3",
															speech.status === "starting" ||
																speech.status === "listening"
																? "text-rose-500 hover:text-rose-600"
																: "text-muted-foreground/70 hover:text-foreground/80",
														)}
														disabled={voiceDisabled}
														onClick={toggleVoice}
														aria-label={
															speech.status === "starting" ||
															speech.status === "listening"
																? "Stop voice input"
																: "Start voice input"
														}
													>
														{speech.status === "starting" ||
														speech.status === "listening" ? (
															<span className="flex items-center gap-1.5">
																<span
																	className="size-2 shrink-0 animate-pulse rounded-full bg-rose-500"
																	aria-hidden
																/>
																<span className="sr-only sm:not-sr-only">
																	{speech.status === "starting"
																		? "Starting…"
																		: "Listening…"}
																</span>
															</span>
														) : (
															<Mic className="size-4" />
														)}
													</Button>
												}
											/>
											<TooltipPopup side="top">
												{speech.status === "starting"
													? "Starting voice input"
													: speech.status === "listening"
														? "Stop voice input"
														: "Voice input"}
											</TooltipPopup>
										</Tooltip>
									</>
								) : null}
							</div>

							<div className="flex shrink-0 items-center gap-2">
								{props.isPreparingWorktree ? (
									<span className="text-muted-foreground/70 text-xs">
										Preparing worktree...
									</span>
								) : null}
								{props.activePendingProgress ? (
									<div className="flex items-center gap-2">
										{props.activePendingProgress.questionIndex > 0 ? (
											<Button
												size="sm"
												variant="outline"
												className="rounded-full"
												onClick={props.onPreviousActivePendingUserInputQuestion}
												disabled={props.activePendingIsResponding}
											>
												Previous
											</Button>
										) : null}
										<Button
											type="submit"
											size="sm"
											className="rounded-full px-4"
											disabled={
												props.activePendingIsResponding ||
												(props.activePendingProgress.isLastQuestion
													? !props.activePendingResolvedAnswers
													: !props.activePendingProgress.canAdvance)
											}
										>
											{props.activePendingIsResponding
												? "Submitting..."
												: props.activePendingProgress.isLastQuestion
													? "Submit answers"
													: "Next question"}
										</Button>
									</div>
								) : props.phase === "running" ? (
									<div className="flex items-center gap-2">
										{props.prompt.trim().length > 0 && (
											<button
												type="submit"
												className="flex h-9 items-center justify-center rounded-full bg-primary/90 px-4 text-sm text-primary-foreground transition-all hover:bg-primary sm:h-8"
												disabled={props.isSendBusy || props.isConnecting}
												title="Queue this message (will send after current turn)"
											>
												Queue
											</button>
										)}
										<button
											type="button"
											className="flex size-8 items-center justify-center rounded-full bg-destructive/90 text-white transition-all duration-150 hover:bg-destructive hover:scale-105 sm:h-8 sm:w-8"
											onClick={() => void props.onInterrupt()}
											aria-label="Stop generation"
										>
											<svg
												width="12"
												height="12"
												viewBox="0 0 12 12"
												fill="currentColor"
												aria-hidden="true"
											>
												<rect x="2" y="2" width="8" height="8" rx="1.5" />
											</svg>
										</button>
									</div>
								) : props.pendingUserInputs.length === 0 ? (
									props.showPlanFollowUpPrompt ? (
										props.prompt.trim().length > 0 ? (
											<Button
												type="submit"
												size="sm"
												className="h-9 rounded-full px-4 sm:h-8"
												disabled={props.isSendBusy || props.isConnecting}
											>
												{props.isConnecting || props.isSendBusy
													? "Sending..."
													: "Refine"}
											</Button>
										) : (
											<div className="flex items-center">
												<Button
													type="submit"
													size="sm"
													className="h-9 rounded-l-full rounded-r-none px-4 sm:h-8"
													disabled={props.isSendBusy || props.isConnecting}
												>
													{props.isConnecting || props.isSendBusy
														? "Sending..."
														: "Implement"}
												</Button>
												<Menu>
													<MenuTrigger
														render={
															<Button
																size="sm"
																variant="default"
																className="h-9 rounded-l-none rounded-r-full border-l-white/12 px-2 sm:h-8"
																aria-label="Implementation actions"
																disabled={
																	props.isSendBusy || props.isConnecting
																}
															/>
														}
													>
														<ChevronDownIcon className="size-3.5" />
													</MenuTrigger>
													<MenuPopup align="end" side="top">
														<MenuItem
															disabled={props.isSendBusy || props.isConnecting}
															onClick={() =>
																void props.onImplementPlanInNewThread()
															}
														>
															Implement in new thread
														</MenuItem>
													</MenuPopup>
												</Menu>
											</div>
										)
									) : (
										<button
											type="submit"
											className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/90 text-primary-foreground transition-all duration-150 hover:bg-primary hover:scale-105 disabled:opacity-30 disabled:hover:scale-100 sm:h-8 sm:w-8"
											disabled={
												props.isSendBusy ||
												props.isConnecting ||
												(!props.prompt.trim() &&
													props.composerImages.length === 0)
											}
											aria-label={
												props.isConnecting
													? "Connecting"
													: props.isPreparingWorktree
														? "Preparing worktree"
														: props.isSendBusy
															? "Sending"
															: "Send message"
											}
										>
											{props.isConnecting || props.isSendBusy ? (
												<svg
													width="14"
													height="14"
													viewBox="0 0 14 14"
													fill="none"
													className="animate-spin"
													aria-hidden="true"
												>
													<circle
														cx="7"
														cy="7"
														r="5.5"
														stroke="currentColor"
														strokeWidth="1.5"
														strokeLinecap="round"
														strokeDasharray="20 12"
													/>
												</svg>
											) : (
												<svg
													width="14"
													height="14"
													viewBox="0 0 14 14"
													fill="none"
													aria-hidden="true"
												>
													<path
														d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
														stroke="currentColor"
														strokeWidth="1.8"
														strokeLinecap="round"
														strokeLinejoin="round"
													/>
												</svg>
											)}
										</button>
									)
								) : null}
							</div>
						</div>
					)}
				</section>
			</form>
		</div>
	);
}
