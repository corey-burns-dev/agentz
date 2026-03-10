import {
	type ApprovalRequestId,
	type CodexReasoningEffort,
	DEFAULT_MODEL_BY_PROVIDER,
	type EditorId,
	type MessageId,
	type ModelSlug,
	type OrchestrationThreadActivity,
	PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
	PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
	type ProjectEntry,
	type ProjectScript,
	type ProviderApprovalDecision,
	type ProviderInteractionMode,
	type ProviderKind,
	type ResolvedKeybindingsConfig,
	type RuntimeMode,
	type ServerProviderStatus,
	type ThreadId,
	type TurnId,
} from "@agents/contracts";
import {
	getDefaultModel,
	getDefaultReasoningEffort,
	getReasoningEffortOptions,
	normalizeModelSlug,
	resolveModelSlugForProvider,
} from "@agents/shared/model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import {
	useCallback,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	gitBranchesQueryOptions,
	gitCreateWorktreeMutationOptions,
} from "~/lib/gitReactQuery";
import { projectSearchEntriesQueryOptions } from "~/lib/projectReactQuery";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { newCommandId, newMessageId, newThreadId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import {
	projectScriptIdFromCommand,
	projectScriptRuntimeEnv,
	setupProjectScript,
} from "~/projectScripts";
import {
	getAppModelOptions,
	getCustomModelsForProvider,
	getProviderStartOptionsForProvider,
	resolveAppModelSelection,
	resolveAppServiceTier,
	shouldShowFastTierIcon,
	useAppSettings,
} from "../appSettings";
import {
	type ComposerTrigger,
	detectComposerTrigger,
	expandCollapsedComposerCursor,
	parseStandaloneComposerSlashCommand,
	replaceTextRange,
} from "../composer-logic";
import {
	type ComposerImageAttachment,
	type DraftThreadEnvMode,
	type PersistedComposerImageAttachment,
	useComposerDraftStore,
	useComposerThreadDraft,
} from "../composerDraftStore";
import {
	parseDiffRouteSearch,
	stripDiffSearchParams,
} from "../diffRouteSearch";
import { isDesktopShell } from "../env";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useImageAttachments } from "../hooks/useImageAttachments";
import { useProjectScripts } from "../hooks/useProjectScripts";
import { useScrollBehavior } from "../hooks/useScrollBehavior";
import { isSpeechRecognitionSupported } from "../hooks/useSpeechRecognition";
import { useTerminalManagement } from "../hooks/useTerminalManagement";
import { useTheme } from "../hooks/useTheme";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import {
	resolveShortcutCommand,
	shortcutLabelForCommand,
} from "../keybindings";
import {
	collectUserMessageBlobPreviewUrls,
	readFileAsDataUrl,
	revokeUserMessagePreviewUrls,
} from "../lib/imageUtils";
import {
	buildPendingUserInputAnswers,
	derivePendingUserInputProgress,
	type PendingUserInputDraftAnswer,
	setPendingUserInputCustomAnswer,
} from "../pendingUserInput";
import {
	parseProjectDockRouteSearch,
	stripProjectDockSearchParams,
} from "../projectDockRouteSearch";
import {
	buildPlanImplementationPrompt,
	buildPlanImplementationThreadTitle,
	resolvePlanFollowUpSubmission,
} from "../proposedPlan";
import {
	resolveSelectedProvider,
	resolveVisibleProviderOptions,
} from "../providerSelection";
import { stripSettingsTabSearchParams } from "../routes/settings/-settingsNavigation";
import {
	deriveActivePlanState,
	deriveActiveWorkStartedAt,
	derivePendingApprovals,
	derivePendingUserInputs,
	derivePhase,
	deriveTimelineEntries,
	deriveWorkLogEntries,
	findLatestProposedPlan,
	formatElapsed,
	hasToolActivityForTurn,
	isLatestTurnSettled,
} from "../session-logic";
import { useStore } from "../store";
import {
	selectThreadTerminalState,
	useTerminalStateStore,
} from "../terminalStateStore";
import { buildLocalDraftThread } from "../threadDrafts";
import { truncateTitle } from "../truncateTitle";
import {
	type ChatMessage,
	DEFAULT_INTERACTION_MODE,
	DEFAULT_RUNTIME_MODE,
	MAX_THREAD_TERMINAL_COUNT,
	type TurnDiffSummary,
} from "../types";
import { basenameOfPath } from "../vscode-icons";
import BranchToolbar from "./BranchToolbar";
import { ComposerArea, type ComposerCommandItem } from "./ChatViewComposerArea";
import { type ExpandedImagePreview, MessageList } from "./ChatViewMessageList";
import { Toolbar } from "./ChatViewToolbar";
import type { ComposerPromptEditorHandle } from "./ComposerPromptEditor";
import PlanSidebar from "./PlanSidebar";
import ThreadTerminalDrawer from "./ThreadTerminalDrawer";
import { Button } from "./ui/button";
import { SidebarTrigger } from "./ui/sidebar";
import { toastManager } from "./ui/toast";

const IMAGE_SIZE_LIMIT_LABEL = `${Math.round(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES / (1024 * 1024))}MB`;
const IMAGE_ONLY_BOOTSTRAP_PROMPT =
	"[User attached one or more images without additional text. Respond using the conversation context and the attached image(s).]";
const EMPTY_ACTIVITIES: OrchestrationThreadActivity[] = [];
const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
const EMPTY_PROJECT_ENTRIES: ProjectEntry[] = [];
const EMPTY_AVAILABLE_EDITORS: EditorId[] = [];
const EMPTY_PROVIDER_STATUSES: ServerProviderStatus[] = [];
const EMPTY_PENDING_USER_INPUT_ANSWERS: Record<
	string,
	PendingUserInputDraftAnswer
> = {};
const COMPOSER_PATH_QUERY_DEBOUNCE_MS = 120;
const WORKTREE_BRANCH_PREFIX = "agents";

function getCustomModelOptionsByProvider(settings: {
	customCodexModels: readonly string[];
	customGeminiModels: readonly string[];
	customClaudeCodeModels: readonly string[];
}): Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>> {
	return {
		codex: getAppModelOptions(
			"codex",
			getCustomModelsForProvider(settings, "codex"),
		),
		gemini: getAppModelOptions(
			"gemini",
			getCustomModelsForProvider(settings, "gemini"),
		),
		"claude-code": getAppModelOptions(
			"claude-code",
			getCustomModelsForProvider(settings, "claude-code"),
		),
	};
}

type SendPhase = "idle" | "preparing-worktree" | "sending-turn";

function buildTemporaryWorktreeBranchName(): string {
	// Keep the 8-hex suffix shape for backend temporary-branch detection.
	const token = crypto.randomUUID().slice(0, 8).toLowerCase();
	return `${WORKTREE_BRANCH_PREFIX}/${token}`;
}

function cloneComposerImageForRetry(
	image: ComposerImageAttachment,
): ComposerImageAttachment {
	if (typeof URL === "undefined" || !image.previewUrl.startsWith("blob:")) {
		return image;
	}
	try {
		return {
			...image,
			previewUrl: URL.createObjectURL(image.file),
		};
	} catch {
		return image;
	}
}

interface ChatViewProps {
	threadId: ThreadId;
}

export default function ChatView({ threadId }: ChatViewProps) {
	const threads = useStore((store) => store.threads);
	const projects = useStore((store) => store.projects);
	const markThreadVisited = useStore((store) => store.markThreadVisited);
	const syncServerReadModel = useStore((store) => store.syncServerReadModel);
	const setStoreThreadError = useStore((store) => store.setError);
	const setStoreThreadBranch = useStore((store) => store.setThreadBranch);
	const { settings } = useAppSettings();
	const navigate = useNavigate();
	const rawSearch = useSearch({
		strict: false,
		select: (params) => ({
			...parseDiffRouteSearch(params),
			...parseProjectDockRouteSearch(params),
		}),
	});
	const { resolvedTheme } = useTheme();
	const queryClient = useQueryClient();
	const serverConfigQuery = useQuery(serverConfigQueryOptions());
	const createWorktreeMutation = useMutation(
		gitCreateWorktreeMutationOptions({ queryClient }),
	);
	const composerDraft = useComposerThreadDraft(threadId);
	const prompt = composerDraft.prompt;
	const composerImages = composerDraft.images;
	const nonPersistedComposerImageIds = composerDraft.nonPersistedImageIds;
	const setComposerDraftPrompt = useComposerDraftStore(
		(store) => store.setPrompt,
	);
	const setComposerDraftProvider = useComposerDraftStore(
		(store) => store.setProvider,
	);
	const setComposerDraftModel = useComposerDraftStore(
		(store) => store.setModel,
	);
	const setComposerDraftRuntimeMode = useComposerDraftStore(
		(store) => store.setRuntimeMode,
	);
	const setComposerDraftInteractionMode = useComposerDraftStore(
		(store) => store.setInteractionMode,
	);
	const setComposerDraftEffort = useComposerDraftStore(
		(store) => store.setEffort,
	);
	const setComposerDraftCodexFastMode = useComposerDraftStore(
		(store) => store.setCodexFastMode,
	);
	const addComposerDraftImage = useComposerDraftStore(
		(store) => store.addImage,
	);
	const addComposerDraftImages = useComposerDraftStore(
		(store) => store.addImages,
	);
	const removeComposerDraftImage = useComposerDraftStore(
		(store) => store.removeImage,
	);
	const clearComposerDraftPersistedAttachments = useComposerDraftStore(
		(store) => store.clearPersistedAttachments,
	);
	const syncComposerDraftPersistedAttachments = useComposerDraftStore(
		(store) => store.syncPersistedAttachments,
	);
	const clearComposerDraftContent = useComposerDraftStore(
		(store) => store.clearComposerContent,
	);
	const clearDraftThread = useComposerDraftStore(
		(store) => store.clearDraftThread,
	);
	const setDraftThreadContext = useComposerDraftStore(
		(store) => store.setDraftThreadContext,
	);
	const draftThread = useComposerDraftStore(
		(store) => store.draftThreadsByThreadId[threadId] ?? null,
	);
	const promptRef = useRef(prompt);
	const [isDragOverComposer, setIsDragOverComposer] = useState(false);
	const [expandedImage, setExpandedImage] =
		useState<ExpandedImagePreview | null>(null);
	const [optimisticUserMessages, setOptimisticUserMessages] = useState<
		ChatMessage[]
	>([]);
	const optimisticUserMessagesRef = useRef(optimisticUserMessages);
	optimisticUserMessagesRef.current = optimisticUserMessages;
	const [localDraftErrorsByThreadId, setLocalDraftErrorsByThreadId] = useState<
		Record<ThreadId, string | null>
	>({});
	const [sendPhase, setSendPhase] = useState<SendPhase>("idle");
	const [sendStartedAt, setSendStartedAt] = useState<string | null>(null);
	const [isRevertingCheckpoint, setIsRevertingCheckpoint] = useState(false);
	const [respondingRequestIds, setRespondingRequestIds] = useState<
		ApprovalRequestId[]
	>([]);
	const [respondingUserInputRequestIds, setRespondingUserInputRequestIds] =
		useState<ApprovalRequestId[]>([]);
	const [
		pendingUserInputAnswersByRequestId,
		setPendingUserInputAnswersByRequestId,
	] = useState<Record<string, Record<string, PendingUserInputDraftAnswer>>>({});
	const [
		pendingUserInputQuestionIndexByRequestId,
		setPendingUserInputQuestionIndexByRequestId,
	] = useState<Record<string, number>>({});
	const [expandedWorkGroups, setExpandedWorkGroups] = useState<
		Record<string, boolean>
	>({});
	const [planSidebarOpen, setPlanSidebarOpen] = useState(false);
	const planSidebarDismissedForTurnRef = useRef<string | null>(null);
	const planSidebarOpenOnNextThreadRef = useRef(false);
	// Provider/model for the next "Implement plan in new thread" action; independent of
	// lockedProvider so the user can choose a different AI for the new thread.
	const [implementationProvider, setImplementationProvider] =
		useState<ProviderKind>("codex");
	const [implementationModel, setImplementationModel] = useState<ModelSlug>(
		() => DEFAULT_MODEL_BY_PROVIDER.codex,
	);
	const [nowTick, setNowTick] = useState(() => Date.now());
	const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<
		string | null
	>(null);
	const [composerCursor, setComposerCursor] = useState(() => prompt.length);
	const [composerTrigger, setComposerTrigger] =
		useState<ComposerTrigger | null>(() =>
			detectComposerTrigger(prompt, prompt.length),
		);
	const messagesScrollRef = useRef<HTMLDivElement>(null);
	const [messagesScrollElement, setMessagesScrollElement] =
		useState<HTMLDivElement | null>(null);
	const composerEditorRef = useRef<ComposerPromptEditorHandle>(null);
	const composerFormRef = useRef<HTMLFormElement>(null);
	const composerFormHeightRef = useRef(0);
	const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
	const composerSelectLockRef = useRef(false);
	const composerMenuOpenRef = useRef(false);
	const composerMenuItemsRef = useRef<ComposerCommandItem[]>([]);
	const activeComposerMenuItemRef = useRef<ComposerCommandItem | null>(null);
	const sendInFlightRef = useRef(false);
	const dragDepthRef = useRef(0);

	const [pendingQueue, setPendingQueue] = useState<
		{
			threadId: string;
			prompt: string;
			images: ComposerImageAttachment[];
		}[]
	>([]);
	const pendingQueueRef = useRef(pendingQueue);
	useEffect(() => {
		pendingQueueRef.current = pendingQueue;
	}, [pendingQueue]);

	const setMessagesScrollContainerRef = useCallback(
		(element: HTMLDivElement | null) => {
			messagesScrollRef.current = element;
			setMessagesScrollElement(element);
		},
		[],
	);

	const terminalState = useTerminalStateStore((state) =>
		selectThreadTerminalState(state.terminalStateByThreadId, threadId),
	);

	const setPrompt = useCallback(
		(nextPrompt: string) => {
			setComposerDraftPrompt(threadId, nextPrompt);
		},
		[setComposerDraftPrompt, threadId],
	);
	const addComposerImage = useCallback(
		(image: ComposerImageAttachment) => {
			addComposerDraftImage(threadId, image);
		},
		[addComposerDraftImage, threadId],
	);
	const addComposerImagesToDraft = useCallback(
		(images: ComposerImageAttachment[]) => {
			addComposerDraftImages(threadId, images);
		},
		[addComposerDraftImages, threadId],
	);
	const removeComposerImageFromDraft = useCallback(
		(imageId: string) => {
			removeComposerDraftImage(threadId, imageId);
		},
		[removeComposerDraftImage, threadId],
	);

	const serverThread = threads.find((t) => t.id === threadId);
	const fallbackDraftProject = projects.find(
		(project) => project.id === draftThread?.projectId,
	);
	const localDraftError = serverThread
		? null
		: (localDraftErrorsByThreadId[threadId] ?? null);
	const localDraftThread = useMemo(
		() =>
			draftThread
				? buildLocalDraftThread(
						threadId,
						draftThread,
						fallbackDraftProject?.model ?? DEFAULT_MODEL_BY_PROVIDER.codex,
						localDraftError,
					)
				: undefined,
		[draftThread, fallbackDraftProject?.model, localDraftError, threadId],
	);
	const activeThread = serverThread ?? localDraftThread;
	const runtimeMode =
		composerDraft.runtimeMode ??
		activeThread?.runtimeMode ??
		DEFAULT_RUNTIME_MODE;
	const interactionMode =
		composerDraft.interactionMode ??
		activeThread?.interactionMode ??
		DEFAULT_INTERACTION_MODE;
	const isServerThread = serverThread !== undefined;
	const isLocalDraftThread = !isServerThread && localDraftThread !== undefined;
	const diffSearch = useMemo(
		() => ({
			...parseDiffRouteSearch(rawSearch as Record<string, unknown>),
			...parseProjectDockRouteSearch(rawSearch as Record<string, unknown>),
		}),
		[rawSearch],
	);
	const diffOpen = diffSearch.diff === "1";
	const projectDockOpen = diffSearch.projectDock === "1" && !diffOpen;
	const activeThreadId = activeThread?.id ?? null;
	const activeLatestTurn = activeThread?.latestTurn ?? null;
	const latestTurnSettled = isLatestTurnSettled(
		activeLatestTurn,
		activeThread?.session ?? null,
	);
	const activeProject = projects.find((p) => p.id === activeThread?.projectId);

	useEffect(() => {
		// Keep the local draft route stable until the projected thread with the same
		// id arrives from the server, then clear the draft state.
		if (!serverThread || !draftThread) {
			return;
		}
		clearDraftThread(threadId);
	}, [clearDraftThread, draftThread, serverThread, threadId]);

	useEffect(() => {
		if (!activeThread?.id) return;
		if (!latestTurnSettled) return;
		if (!activeLatestTurn?.completedAt) return;
		const turnCompletedAt = Date.parse(activeLatestTurn.completedAt);
		if (Number.isNaN(turnCompletedAt)) return;
		const lastVisitedAt = activeThread.lastVisitedAt
			? Date.parse(activeThread.lastVisitedAt)
			: NaN;
		if (!Number.isNaN(lastVisitedAt) && lastVisitedAt >= turnCompletedAt)
			return;

		markThreadVisited(activeThread.id);
	}, [
		activeThread?.id,
		activeThread?.lastVisitedAt,
		activeLatestTurn?.completedAt,
		latestTurnSettled,
		markThreadVisited,
	]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally run on active thread change
	useEffect(() => {
		setExpandedWorkGroups({});
		if (planSidebarOpenOnNextThreadRef.current) {
			planSidebarOpenOnNextThreadRef.current = false;
			setPlanSidebarOpen(true);
		} else {
			setPlanSidebarOpen(false);
		}
		planSidebarDismissedForTurnRef.current = null;
	}, [activeThread?.id]);

	const sessionProvider = activeThread?.session?.provider ?? null;
	const selectedProviderByThreadId = composerDraft.provider;
	const hasThreadStarted = Boolean(
		activeThread &&
			(activeThread.latestTurn !== null ||
				activeThread.messages.length > 0 ||
				activeThread.session !== null),
	);
	const hasNoPendingApprovalOrInput = useMemo(() => {
		const activities = activeThread?.activities ?? [];
		return (
			derivePendingApprovals(activities).length === 0 &&
			derivePendingUserInputs(activities).length === 0
		);
	}, [activeThread?.activities]);
	const sessionIdleOrStopped = Boolean(
		!activeThread?.session ||
			activeThread.session.status === "ready" ||
			activeThread.session.status === "closed",
	);
	const threadCanSwitchProvider = Boolean(
		hasThreadStarted &&
			latestTurnSettled &&
			sessionIdleOrStopped &&
			hasNoPendingApprovalOrInput,
	);
	const selectedServiceTierSetting = settings.codexServiceTier;
	const selectedServiceTier = resolveAppServiceTier(selectedServiceTierSetting);
	const lockedProvider: ProviderKind | null = null;
	const providerStatuses =
		serverConfigQuery.data?.providers ?? EMPTY_PROVIDER_STATUSES;
	const selectedProvider: ProviderKind = resolveSelectedProvider({
		lockedProvider,
		draftProvider: selectedProviderByThreadId,
		sessionProvider,
		threadModel: activeThread?.model ?? null,
		projectModel: activeProject?.model ?? null,
	});
	const effectiveInteractionMode: ProviderInteractionMode =
		selectedProvider === "gemini" ? "default" : interactionMode;
	const baseThreadModel = resolveModelSlugForProvider(
		selectedProvider,
		activeThread?.model ??
			activeProject?.model ??
			getDefaultModel(selectedProvider),
	);
	const customModelsForSelectedProvider = getCustomModelsForProvider(
		settings,
		selectedProvider,
	);
	const selectedModel = useMemo(() => {
		const draftModel = composerDraft.model;
		if (!draftModel) {
			return baseThreadModel;
		}
		return resolveAppModelSelection(
			selectedProvider,
			customModelsForSelectedProvider,
			draftModel,
		) as ModelSlug;
	}, [
		baseThreadModel,
		composerDraft.model,
		customModelsForSelectedProvider,
		selectedProvider,
	]);
	const reasoningOptions = getReasoningEffortOptions(selectedProvider);
	const supportsReasoningEffort = reasoningOptions.length > 0;
	const selectedEffort =
		composerDraft.effort ?? getDefaultReasoningEffort(selectedProvider);
	const selectedCodexFastModeEnabled =
		selectedProvider === "codex" ? composerDraft.codexFastMode : false;
	const selectedModelOptionsForDispatch = useMemo(() => {
		if (selectedProvider !== "codex") {
			return undefined;
		}
		const codexOptions = {
			...(supportsReasoningEffort && selectedEffort
				? { reasoningEffort: selectedEffort }
				: {}),
			...(selectedCodexFastModeEnabled ? { fastMode: true } : {}),
		};
		return Object.keys(codexOptions).length > 0
			? { codex: codexOptions }
			: undefined;
	}, [
		selectedCodexFastModeEnabled,
		selectedEffort,
		selectedProvider,
		supportsReasoningEffort,
	]);
	const selectedProviderStartOptions = useMemo(
		() => getProviderStartOptionsForProvider(settings, selectedProvider),
		[settings, selectedProvider],
	);
	const selectedModelForPicker = selectedModel;
	const modelOptionsByProvider = useMemo(
		() => getCustomModelOptionsByProvider(settings),
		[settings],
	);
	const selectedModelForPickerWithCustomFallback = useMemo(() => {
		const currentOptions = modelOptionsByProvider[selectedProvider];
		return currentOptions.some(
			(option) => option.slug === selectedModelForPicker,
		)
			? selectedModelForPicker
			: (normalizeModelSlug(selectedModelForPicker, selectedProvider) ??
					selectedModelForPicker);
	}, [modelOptionsByProvider, selectedModelForPicker, selectedProvider]);
	const availableProviderOptions = useMemo(
		() =>
			resolveVisibleProviderOptions({
				providerStatuses,
				settings,
			}),
		[providerStatuses, settings],
	);

	const searchableModelOptions = useMemo(
		() =>
			availableProviderOptions.flatMap((option) =>
				modelOptionsByProvider[option.value].map(({ slug, name }) => ({
					provider: option.value,
					providerLabel: option.label,
					slug,
					name,
					searchSlug: slug.toLowerCase(),
					searchName: name.toLowerCase(),
					searchProvider: option.label.toLowerCase(),
				})),
			),
		[availableProviderOptions, modelOptionsByProvider],
	);

	const implementationProviderStartOptions = useMemo(
		() => getProviderStartOptionsForProvider(settings, implementationProvider),
		[settings, implementationProvider],
	);
	const implementationReasoningOptions = getReasoningEffortOptions(
		implementationProvider,
	);
	const implementationModelOptionsForDispatch = useMemo(() => {
		if (implementationProvider !== "codex") return undefined;
		const defaultEffort = getDefaultReasoningEffort(implementationProvider);
		const codexOptions = {
			...(implementationReasoningOptions.length > 0 && defaultEffort
				? { reasoningEffort: defaultEffort }
				: {}),
		};
		return Object.keys(codexOptions).length > 0
			? { codex: codexOptions }
			: undefined;
	}, [implementationProvider, implementationReasoningOptions.length]);
	const implementationModelForPickerWithCustomFallback = useMemo(() => {
		const currentOptions = modelOptionsByProvider[implementationProvider];
		return currentOptions.some((option) => option.slug === implementationModel)
			? implementationModel
			: (normalizeModelSlug(implementationModel, implementationProvider) ??
					implementationModel);
	}, [implementationModel, implementationProvider, modelOptionsByProvider]);

	const phase = derivePhase(activeThread?.session ?? null);
	const {
		onMessagesScroll,
		onMessagesWheel,
		onMessagesClickCapture,
		onMessagesPointerDown,
		onMessagesPointerUp,
		onMessagesPointerCancel,
		onMessagesTouchStart,
		onMessagesTouchMove,
		onMessagesTouchEnd,
		forceStickToBottom,
		shouldAutoScrollRef,
	} = useScrollBehavior({
		messagesScrollRef,
		composerFormRef,
		composerFormHeightRef,
		activeThreadId: activeThread?.id,
		phase,
	});
	const isConnecting = phase === "connecting";
	const isSendBusy = sendPhase !== "idle";
	const isPreparingWorktree = sendPhase === "preparing-worktree";
	const isWorking =
		phase === "running" || isSendBusy || isConnecting || isRevertingCheckpoint;
	const nowIso = new Date(nowTick).toISOString();
	const activeWorkStartedAt = deriveActiveWorkStartedAt(
		activeLatestTurn,
		activeThread?.session ?? null,
		sendStartedAt,
	);
	const threadActivities = activeThread?.activities ?? EMPTY_ACTIVITIES;
	const workLogEntries = useMemo(
		() =>
			deriveWorkLogEntries(
				threadActivities,
				activeLatestTurn?.turnId ?? undefined,
			),
		[activeLatestTurn?.turnId, threadActivities],
	);
	const latestTurnHasToolActivity = useMemo(
		() => hasToolActivityForTurn(threadActivities, activeLatestTurn?.turnId),
		[activeLatestTurn?.turnId, threadActivities],
	);
	const pendingApprovals = useMemo(
		() => derivePendingApprovals(threadActivities),
		[threadActivities],
	);
	const pendingUserInputs = useMemo(
		() => derivePendingUserInputs(threadActivities),
		[threadActivities],
	);
	const activePendingUserInput = pendingUserInputs[0] ?? null;
	const activePendingDraftAnswers = useMemo(
		() =>
			activePendingUserInput
				? (pendingUserInputAnswersByRequestId[
						activePendingUserInput.requestId
					] ?? EMPTY_PENDING_USER_INPUT_ANSWERS)
				: EMPTY_PENDING_USER_INPUT_ANSWERS,
		[activePendingUserInput, pendingUserInputAnswersByRequestId],
	);
	const activePendingQuestionIndex = activePendingUserInput
		? (pendingUserInputQuestionIndexByRequestId[
				activePendingUserInput.requestId
			] ?? 0)
		: 0;
	const activePendingProgress = useMemo(
		() =>
			activePendingUserInput
				? derivePendingUserInputProgress(
						activePendingUserInput.questions,
						activePendingDraftAnswers,
						activePendingQuestionIndex,
					)
				: null,
		[
			activePendingDraftAnswers,
			activePendingQuestionIndex,
			activePendingUserInput,
		],
	);
	const activePendingResolvedAnswers = useMemo(
		() =>
			activePendingUserInput
				? buildPendingUserInputAnswers(
						activePendingUserInput.questions,
						activePendingDraftAnswers,
					)
				: null,
		[activePendingDraftAnswers, activePendingUserInput],
	);
	const activePendingIsResponding = activePendingUserInput
		? respondingUserInputRequestIds.includes(activePendingUserInput.requestId)
		: false;
	const activeProposedPlan = useMemo(() => {
		if (!latestTurnSettled) {
			return null;
		}
		return findLatestProposedPlan(
			activeThread?.proposedPlans ?? [],
			activeLatestTurn?.turnId ?? null,
		);
	}, [
		activeLatestTurn?.turnId,
		activeThread?.proposedPlans,
		latestTurnSettled,
	]);

	// When a proposed plan appears, default implementation-thread provider/model to
	// the current thread so "Implement in new thread" matches existing behavior until
	// the user changes it in the plan sidebar.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only re-init when proposed plan identity changes
	useEffect(() => {
		if (activeProposedPlan?.turnId == null) return;
		setImplementationProvider(selectedProvider);
		setImplementationModel(selectedModel);
	}, [activeProposedPlan?.turnId]);

	const activePlan = useMemo(
		() =>
			deriveActivePlanState(
				threadActivities,
				activeLatestTurn?.turnId ?? undefined,
			),
		[activeLatestTurn?.turnId, threadActivities],
	);
	const showPlanFollowUpPrompt =
		pendingUserInputs.length === 0 &&
		interactionMode === "plan" &&
		latestTurnSettled &&
		activeProposedPlan !== null;
	const activePendingApproval = pendingApprovals[0] ?? null;
	const isComposerApprovalState = activePendingApproval !== null;
	const hasComposerHeader =
		isComposerApprovalState ||
		pendingUserInputs.length > 0 ||
		(showPlanFollowUpPrompt && activeProposedPlan !== null);
	useEffect(() => {
		if (!activePendingProgress) {
			return;
		}
		promptRef.current = activePendingProgress.customAnswer;
		setComposerCursor(activePendingProgress.customAnswer.length);
		setComposerTrigger(
			detectComposerTrigger(
				activePendingProgress.customAnswer,
				expandCollapsedComposerCursor(
					activePendingProgress.customAnswer,
					activePendingProgress.customAnswer.length,
				),
			),
		);
		setComposerHighlightedItemId(null);
	}, [activePendingProgress]);
	const { attachmentPreviewHandoffByMessageId, handoffAttachmentPreviews } =
		useImageAttachments({ optimisticUserMessagesRef });
	const serverMessages = activeThread?.messages;
	const timelineMessages = useMemo(() => {
		const messages = serverMessages ?? [];
		const serverMessagesWithPreviewHandoff =
			Object.keys(attachmentPreviewHandoffByMessageId).length === 0
				? messages
				: // Spread only fires for the few messages that actually changed;
					// unchanged ones early-return their original reference.
					// In-place mutation would break React's immutable state contract.
					messages.map((message) => {
						if (
							message.role !== "user" ||
							!message.attachments ||
							message.attachments.length === 0
						) {
							return message;
						}
						const handoffPreviewUrls =
							attachmentPreviewHandoffByMessageId[message.id];
						if (!handoffPreviewUrls || handoffPreviewUrls.length === 0) {
							return message;
						}

						let changed = false;
						let imageIndex = 0;
						const attachments = message.attachments.map((attachment) => {
							if (attachment.type !== "image") {
								return attachment;
							}
							const handoffPreviewUrl = handoffPreviewUrls[imageIndex];
							imageIndex += 1;
							if (
								!handoffPreviewUrl ||
								attachment.previewUrl === handoffPreviewUrl
							) {
								return attachment;
							}
							changed = true;
							return {
								...attachment,
								previewUrl: handoffPreviewUrl,
							};
						});

						return changed ? { ...message, attachments } : message;
					});

		if (optimisticUserMessages.length === 0) {
			return serverMessagesWithPreviewHandoff;
		}
		const serverIds = new Set(
			serverMessagesWithPreviewHandoff.map((message) => message.id),
		);
		const pendingMessages = optimisticUserMessages.filter(
			(message) => !serverIds.has(message.id),
		);
		if (pendingMessages.length === 0) {
			return serverMessagesWithPreviewHandoff;
		}
		return [...serverMessagesWithPreviewHandoff, ...pendingMessages];
	}, [
		serverMessages,
		attachmentPreviewHandoffByMessageId,
		optimisticUserMessages,
	]);
	const timelineEntries = useMemo(
		() =>
			deriveTimelineEntries(
				timelineMessages,
				activeThread?.proposedPlans ?? [],
				workLogEntries,
			),
		[activeThread?.proposedPlans, timelineMessages, workLogEntries],
	);
	const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
		useTurnDiffSummaries(activeThread);
	const turnDiffSummaryByAssistantMessageId = useMemo(() => {
		const byMessageId = new Map<MessageId, TurnDiffSummary>();
		for (const summary of turnDiffSummaries) {
			if (!summary.assistantMessageId) continue;
			byMessageId.set(summary.assistantMessageId, summary);
		}
		return byMessageId;
	}, [turnDiffSummaries]);
	const revertTurnCountByUserMessageId = useMemo(() => {
		const byUserMessageId = new Map<MessageId, number>();
		for (let index = 0; index < timelineEntries.length; index += 1) {
			const entry = timelineEntries[index];
			if (!entry || entry.kind !== "message" || entry.message.role !== "user") {
				continue;
			}

			for (
				let nextIndex = index + 1;
				nextIndex < timelineEntries.length;
				nextIndex += 1
			) {
				const nextEntry = timelineEntries[nextIndex];
				if (!nextEntry || nextEntry.kind !== "message") {
					continue;
				}
				if (nextEntry.message.role === "user") {
					break;
				}
				const summary = turnDiffSummaryByAssistantMessageId.get(
					nextEntry.message.id,
				);
				if (!summary) {
					continue;
				}
				const turnCount =
					summary.checkpointTurnCount ??
					inferredCheckpointTurnCountByTurnId[summary.turnId];
				if (typeof turnCount !== "number") {
					break;
				}
				byUserMessageId.set(entry.message.id, Math.max(0, turnCount - 1));
				break;
			}
		}

		return byUserMessageId;
	}, [
		inferredCheckpointTurnCountByTurnId,
		timelineEntries,
		turnDiffSummaryByAssistantMessageId,
	]);

	const completionSummary = useMemo(() => {
		if (!latestTurnSettled) return null;
		if (!activeLatestTurn?.startedAt) return null;
		if (!activeLatestTurn.completedAt) return null;
		if (!latestTurnHasToolActivity) return null;

		const elapsed = formatElapsed(
			activeLatestTurn.startedAt,
			activeLatestTurn.completedAt,
		);
		return elapsed ? `Worked for ${elapsed}` : null;
	}, [
		activeLatestTurn?.completedAt,
		activeLatestTurn?.startedAt,
		latestTurnHasToolActivity,
		latestTurnSettled,
	]);
	const completionDividerBeforeEntryId = useMemo(() => {
		if (!latestTurnSettled) return null;
		if (!activeLatestTurn?.startedAt) return null;
		if (!activeLatestTurn.completedAt) return null;
		if (!completionSummary) return null;

		const turnStartedAt = Date.parse(activeLatestTurn.startedAt);
		const turnCompletedAt = Date.parse(activeLatestTurn.completedAt);
		if (Number.isNaN(turnStartedAt)) return null;
		if (Number.isNaN(turnCompletedAt)) return null;

		let inRangeMatch: string | null = null;
		let fallbackMatch: string | null = null;
		for (const timelineEntry of timelineEntries) {
			if (timelineEntry.kind !== "message") continue;
			if (timelineEntry.message.role !== "assistant") continue;
			const messageAt = Date.parse(timelineEntry.message.createdAt);
			if (Number.isNaN(messageAt) || messageAt < turnStartedAt) continue;
			fallbackMatch = timelineEntry.id;
			if (messageAt <= turnCompletedAt) {
				inRangeMatch = timelineEntry.id;
			}
		}
		return inRangeMatch ?? fallbackMatch;
	}, [
		activeLatestTurn?.completedAt,
		activeLatestTurn?.startedAt,
		completionSummary,
		latestTurnSettled,
		timelineEntries,
	]);
	const gitCwd = activeThread?.worktreePath ?? activeProject?.cwd ?? null;
	const composerTriggerKind = composerTrigger?.kind ?? null;
	const pathTriggerQuery =
		composerTrigger?.kind === "path" ? composerTrigger.query : "";
	const isPathTrigger = composerTriggerKind === "path";
	const [debouncedPathQuery, composerPathQueryDebouncer] = useDebouncedValue(
		pathTriggerQuery,
		COMPOSER_PATH_QUERY_DEBOUNCE_MS,
	);
	const effectivePathQuery =
		pathTriggerQuery.length > 0 ? debouncedPathQuery : "";
	const branchesQuery = useQuery(gitBranchesQueryOptions(gitCwd));

	const workspaceEntriesQuery = useQuery(
		projectSearchEntriesQueryOptions({
			cwd: gitCwd,
			query: effectivePathQuery,
			enabled: isPathTrigger,
			limit: 80,
		}),
	);
	const workspaceEntries =
		workspaceEntriesQuery.data?.entries ?? EMPTY_PROJECT_ENTRIES;
	const composerMenuItems = useMemo<ComposerCommandItem[]>(() => {
		if (!composerTrigger) return [];
		if (composerTrigger.kind === "path") {
			return workspaceEntries.map((entry) => ({
				id: `path:${entry.kind}:${entry.path}`,
				type: "path",
				path: entry.path,
				pathKind: entry.kind,
				label: basenameOfPath(entry.path),
				description: entry.parentPath ?? "",
			}));
		}

		if (composerTrigger.kind === "slash-command") {
			const baseSlashItems = [
				{
					id: "slash:model",
					type: "slash-command" as const,
					command: "model",
					label: "/model",
					description: "Switch response model for this thread",
				},
				...(selectedProvider !== "gemini"
					? [
							{
								id: "slash:plan" as const,
								type: "slash-command" as const,
								command: "plan" as const,
								label: "/plan",
								description: "Switch this thread into plan mode",
							},
							{
								id: "slash:default" as const,
								type: "slash-command" as const,
								command: "default" as const,
								label: "/default",
								description: "Switch this thread back to normal chat mode",
							},
						]
					: []),
			] satisfies ReadonlyArray<
				Extract<ComposerCommandItem, { type: "slash-command" }>
			>;
			const query = composerTrigger.query.trim().toLowerCase();
			if (!query) {
				return [...baseSlashItems];
			}
			return baseSlashItems.filter(
				(item) =>
					item.command.includes(query) || item.label.slice(1).includes(query),
			);
		}

		return searchableModelOptions
			.filter(({ searchSlug, searchName, searchProvider }) => {
				const query = composerTrigger.query.trim().toLowerCase();
				if (!query) return true;
				return (
					searchSlug.includes(query) ||
					searchName.includes(query) ||
					searchProvider.includes(query)
				);
			})
			.map(({ provider, providerLabel, slug, name }) => ({
				id: `model:${provider}:${slug}`,
				type: "model",
				provider,
				model: slug,
				label: name,
				description: `${providerLabel} · ${slug}`,
				showFastBadge:
					provider === "codex" &&
					shouldShowFastTierIcon(slug, selectedServiceTierSetting),
			}));
	}, [
		composerTrigger,
		searchableModelOptions,
		selectedProvider,
		selectedServiceTierSetting,
		workspaceEntries,
	]);
	const composerMenuOpen = Boolean(composerTrigger);
	const activeComposerMenuItem = useMemo(
		() =>
			composerMenuItems.find((item) => item.id === composerHighlightedItemId) ??
			composerMenuItems[0] ??
			null,
		[composerHighlightedItemId, composerMenuItems],
	);
	composerMenuOpenRef.current = composerMenuOpen;
	composerMenuItemsRef.current = composerMenuItems;
	activeComposerMenuItemRef.current = activeComposerMenuItem;
	const nonPersistedComposerImageIdSet = useMemo(
		() => new Set(nonPersistedComposerImageIds),
		[nonPersistedComposerImageIds],
	);
	const keybindings = serverConfigQuery.data?.keybindings ?? EMPTY_KEYBINDINGS;
	const availableEditors =
		serverConfigQuery.data?.availableEditors ?? EMPTY_AVAILABLE_EDITORS;
	const activeProvider = activeThread?.session?.provider ?? selectedProvider;
	const activeProviderStatus = useMemo(
		() =>
			providerStatuses.find((status) => status.provider === activeProvider) ??
			null,
		[activeProvider, providerStatuses],
	);
	const activeProjectCwd = activeProject?.cwd ?? null;
	const activeThreadWorktreePath = activeThread?.worktreePath ?? null;
	const threadTerminalRuntimeEnv = useMemo(() => {
		if (!activeProjectCwd) return {};
		return projectScriptRuntimeEnv({
			project: {
				cwd: activeProjectCwd,
			},
			worktreePath: activeThreadWorktreePath,
		});
	}, [activeProjectCwd, activeThreadWorktreePath]);
	// Default true while loading to avoid toolbar flicker.
	const isGitRepo = branchesQuery.data?.isRepo ?? true;
	const splitTerminalShortcutLabel = useMemo(
		() => shortcutLabelForCommand(keybindings, "terminal.split"),
		[keybindings],
	);
	const newTerminalShortcutLabel = useMemo(
		() => shortcutLabelForCommand(keybindings, "terminal.new"),
		[keybindings],
	);
	const closeTerminalShortcutLabel = useMemo(
		() => shortcutLabelForCommand(keybindings, "terminal.close"),
		[keybindings],
	);
	const diffPanelShortcutLabel = useMemo(
		() => shortcutLabelForCommand(keybindings, "diff.toggle"),
		[keybindings],
	);
	const onToggleDiff = useCallback(() => {
		void navigate({
			to: "/$threadId",
			params: { threadId },
			replace: true,
			search: (previous) => {
				const rest = stripSettingsTabSearchParams(
					stripProjectDockSearchParams(stripDiffSearchParams(previous)),
				);
				return diffOpen ? rest : { ...rest, diff: "1" };
			},
		});
	}, [diffOpen, navigate, threadId]);
	const onToggleProjectDock = useCallback(() => {
		void navigate({
			to: "/$threadId",
			params: { threadId },
			replace: true,
			search: (previous) => {
				const rest = stripSettingsTabSearchParams(
					stripDiffSearchParams(stripProjectDockSearchParams(previous)),
				);
				return projectDockOpen
					? rest
					: { ...rest, projectDock: "1", projectDockTab: "git" };
			},
		});
	}, [navigate, projectDockOpen, threadId]);

	const envLocked = Boolean(
		activeThread &&
			(activeThread.messages.length > 0 ||
				(activeThread.session !== null &&
					activeThread.session.status !== "closed")),
	);
	const _hasReachedTerminalLimit =
		terminalState.terminalIds.length >= MAX_THREAD_TERMINAL_COUNT;
	const setThreadError = useCallback(
		(targetThreadId: ThreadId | null, error: string | null) => {
			if (!targetThreadId) return;
			if (threads.some((thread) => thread.id === targetThreadId)) {
				setStoreThreadError(targetThreadId, error);
				return;
			}
			setLocalDraftErrorsByThreadId((existing) => {
				if ((existing[targetThreadId] ?? null) === error) {
					return existing;
				}
				return {
					...existing,
					[targetThreadId]: error,
				};
			});
		},
		[setStoreThreadError, threads],
	);

	const focusComposer = useCallback(() => {
		composerEditorRef.current?.focusAtEnd();
	}, []);

	const handleAppendToPrompt = useCallback(
		(text: string) => {
			if (isComposerApprovalState || !text.trim()) return;
			const current = promptRef.current;
			const trimmed = text.trim();
			const needSpace =
				current.length > 0 &&
				!/\s$/.test(current) &&
				trimmed.length > 0 &&
				!/^\s/.test(trimmed);
			const newPrompt = current + (needSpace ? " " : "") + trimmed;
			const newCursor = newPrompt.length;
			promptRef.current = newPrompt;
			setPrompt(newPrompt);
			setComposerCursor(newCursor);
			setComposerTrigger(detectComposerTrigger(newPrompt, newCursor) ?? null);
			window.requestAnimationFrame(() => {
				composerEditorRef.current?.focusAtEnd();
			});
		},
		[isComposerApprovalState, setPrompt],
	);

	const scheduleComposerFocus = useCallback(() => {
		window.requestAnimationFrame(() => {
			focusComposer();
		});
	}, [focusComposer]);
	const {
		terminalFocusRequestId,
		requestTerminalFocus,
		setTerminalOpen,
		setTerminalHeight,
		toggleTerminalVisibility,
		splitTerminal,
		createNewTerminal,
		activateTerminal,
		closeTerminal,
	} = useTerminalManagement({ threadId, focusComposer });
	const {
		lastInvokedScriptByProjectId,
		runProjectScript,
		saveProjectScript,
		updateProjectScript,
	} = useProjectScripts({
		threadId,
		activeThreadId,
		activeProject: activeProject ?? null,
		activeThread: activeThread ?? null,
		gitCwd,
		isServerThread,
		setTerminalOpen,
		requestTerminalFocus,
		setThreadError,
	});

	const handleRuntimeModeChange = useCallback(
		(mode: RuntimeMode) => {
			if (mode === runtimeMode) return;
			setComposerDraftRuntimeMode(threadId, mode);
			if (isLocalDraftThread) {
				setDraftThreadContext(threadId, { runtimeMode: mode });
			}
			scheduleComposerFocus();
		},
		[
			isLocalDraftThread,
			runtimeMode,
			scheduleComposerFocus,
			setComposerDraftRuntimeMode,
			setDraftThreadContext,
			threadId,
		],
	);

	const handleInteractionModeChange = useCallback(
		(mode: ProviderInteractionMode) => {
			if (mode === interactionMode) return;
			setComposerDraftInteractionMode(threadId, mode);
			if (isLocalDraftThread) {
				setDraftThreadContext(threadId, { interactionMode: mode });
			}
			scheduleComposerFocus();
		},
		[
			interactionMode,
			isLocalDraftThread,
			scheduleComposerFocus,
			setComposerDraftInteractionMode,
			setDraftThreadContext,
			threadId,
		],
	);
	const toggleInteractionMode = useCallback(() => {
		handleInteractionModeChange(
			interactionMode === "plan" ? "default" : "plan",
		);
	}, [handleInteractionModeChange, interactionMode]);

	const persistThreadSettingsForNextTurn = useCallback(
		async (input: {
			threadId: ThreadId;
			createdAt: string;
			model?: string;
			runtimeMode: RuntimeMode;
			interactionMode: ProviderInteractionMode;
		}) => {
			if (!serverThread) {
				return;
			}
			const api = readNativeApi();
			if (!api) {
				return;
			}

			if (input.model !== undefined && input.model !== serverThread.model) {
				await api.orchestration.dispatchCommand({
					type: "thread.meta.update",
					commandId: newCommandId(),
					threadId: input.threadId,
					model: input.model,
				});
			}

			if (input.runtimeMode !== serverThread.runtimeMode) {
				await api.orchestration.dispatchCommand({
					type: "thread.runtime-mode.set",
					commandId: newCommandId(),
					threadId: input.threadId,
					runtimeMode: input.runtimeMode,
					createdAt: input.createdAt,
				});
			}

			if (input.interactionMode !== serverThread.interactionMode) {
				await api.orchestration.dispatchCommand({
					type: "thread.interaction-mode.set",
					commandId: newCommandId(),
					threadId: input.threadId,
					interactionMode: input.interactionMode,
					createdAt: input.createdAt,
				});
			}
		},
		[serverThread],
	);

	useEffect(() => {
		setExpandedWorkGroups({});
	}, []);

	useEffect(() => {
		if (!composerMenuOpen) {
			setComposerHighlightedItemId(null);
			return;
		}
		setComposerHighlightedItemId((existing) =>
			existing && composerMenuItems.some((item) => item.id === existing)
				? existing
				: (composerMenuItems[0]?.id ?? null),
		);
	}, [composerMenuItems, composerMenuOpen]);

	useEffect(() => {
		setIsRevertingCheckpoint(false);
	}, []);

	useEffect(() => {
		if (!activeThread?.id || terminalState.terminalOpen) return;
		const frame = window.requestAnimationFrame(() => {
			focusComposer();
		});
		return () => {
			window.cancelAnimationFrame(frame);
		};
	}, [activeThread?.id, focusComposer, terminalState.terminalOpen]);

	useEffect(() => {
		composerImagesRef.current = composerImages;
	}, [composerImages]);

	useEffect(() => {
		if (!activeThread?.id) return;
		if (activeThread.messages.length === 0) {
			return;
		}
		const serverIds = new Set(
			activeThread.messages.map((message) => message.id),
		);
		const removedMessages = optimisticUserMessages.filter((message) =>
			serverIds.has(message.id),
		);
		if (removedMessages.length === 0) {
			return;
		}
		const timer = window.setTimeout(() => {
			setOptimisticUserMessages((existing) =>
				existing.filter((message) => !serverIds.has(message.id)),
			);
		}, 0);
		for (const removedMessage of removedMessages) {
			const previewUrls = collectUserMessageBlobPreviewUrls(removedMessage);
			if (previewUrls.length > 0) {
				handoffAttachmentPreviews(removedMessage.id, previewUrls);
				continue;
			}
			revokeUserMessagePreviewUrls(removedMessage);
		}
		return () => {
			window.clearTimeout(timer);
		};
	}, [
		activeThread?.id,
		activeThread?.messages,
		handoffAttachmentPreviews,
		optimisticUserMessages,
	]);

	useEffect(() => {
		promptRef.current = prompt;
		setComposerCursor((existing) =>
			Math.min(Math.max(0, existing), prompt.length),
		);
	}, [prompt]);

	useEffect(() => {
		setOptimisticUserMessages((existing) => {
			for (const message of existing) {
				revokeUserMessagePreviewUrls(message);
			}
			return [];
		});
		setSendPhase("idle");
		setSendStartedAt(null);
		setComposerHighlightedItemId(null);
		setComposerCursor(promptRef.current.length);
		setComposerTrigger(
			detectComposerTrigger(promptRef.current, promptRef.current.length),
		);
		dragDepthRef.current = 0;
		setIsDragOverComposer(false);
		setExpandedImage(null);
	}, []);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			if (composerImages.length === 0) {
				clearComposerDraftPersistedAttachments(threadId);
				return;
			}
			const getPersistedAttachmentsForThread = () =>
				useComposerDraftStore.getState().draftsByThreadId[threadId]
					?.persistedAttachments ?? [];
			try {
				const currentPersistedAttachments = getPersistedAttachmentsForThread();
				const existingPersistedById = new Map(
					currentPersistedAttachments.map((attachment) => [
						attachment.id,
						attachment,
					]),
				);
				const stagedAttachmentById = new Map<
					string,
					PersistedComposerImageAttachment
				>();
				await Promise.all(
					composerImages.map(async (image) => {
						try {
							const dataUrl = await readFileAsDataUrl(image.file);
							stagedAttachmentById.set(image.id, {
								id: image.id,
								name: image.name,
								mimeType: image.mimeType,
								sizeBytes: image.sizeBytes,
								dataUrl,
							});
						} catch {
							const existingPersisted = existingPersistedById.get(image.id);
							if (existingPersisted) {
								stagedAttachmentById.set(image.id, existingPersisted);
							}
						}
					}),
				);
				const serialized = Array.from(stagedAttachmentById.values());
				if (cancelled) {
					return;
				}
				// Stage attachments in persisted draft state first so persist middleware can write them.
				syncComposerDraftPersistedAttachments(threadId, serialized);
			} catch {
				const currentImageIds = new Set(
					composerImages.map((image) => image.id),
				);
				const fallbackPersistedAttachments = getPersistedAttachmentsForThread();
				const fallbackPersistedIds = fallbackPersistedAttachments
					.map((attachment) => attachment.id)
					.filter((id) => currentImageIds.has(id));
				const fallbackPersistedIdSet = new Set(fallbackPersistedIds);
				const fallbackAttachments = fallbackPersistedAttachments.filter(
					(attachment) => fallbackPersistedIdSet.has(attachment.id),
				);
				if (cancelled) {
					return;
				}
				syncComposerDraftPersistedAttachments(threadId, fallbackAttachments);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [
		clearComposerDraftPersistedAttachments,
		composerImages,
		syncComposerDraftPersistedAttachments,
		threadId,
	]);

	const closeExpandedImage = useCallback(() => {
		setExpandedImage(null);
	}, []);
	const navigateExpandedImage = useCallback((direction: -1 | 1) => {
		setExpandedImage((existing) => {
			if (!existing || existing.images.length <= 1) {
				return existing;
			}
			const nextIndex =
				(existing.index + direction + existing.images.length) %
				existing.images.length;
			if (nextIndex === existing.index) {
				return existing;
			}
			return { ...existing, index: nextIndex };
		});
	}, []);

	useEffect(() => {
		if (!expandedImage) {
			return;
		}

		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				closeExpandedImage();
				return;
			}
			if (expandedImage.images.length <= 1) {
				return;
			}
			if (event.key === "ArrowLeft") {
				event.preventDefault();
				event.stopPropagation();
				navigateExpandedImage(-1);
				return;
			}
			if (event.key !== "ArrowRight") return;
			event.preventDefault();
			event.stopPropagation();
			navigateExpandedImage(1);
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [closeExpandedImage, expandedImage, navigateExpandedImage]);

	const activeWorktreePath = activeThread?.worktreePath;
	const envMode: DraftThreadEnvMode = activeWorktreePath
		? "worktree"
		: isLocalDraftThread
			? (draftThread?.envMode ?? "local")
			: "local";

	useEffect(() => {
		if (phase !== "running") return;
		const timer = window.setInterval(() => {
			setNowTick(Date.now());
		}, 1000);
		return () => {
			window.clearInterval(timer);
		};
	}, [phase]);

	const beginSendPhase = useCallback(
		(nextPhase: Exclude<SendPhase, "idle">) => {
			setSendStartedAt((current) => current ?? new Date().toISOString());
			setSendPhase(nextPhase);
		},
		[],
	);

	const resetSendPhase = useCallback(() => {
		setSendPhase("idle");
		setSendStartedAt(null);
	}, []);

	useEffect(() => {
		if (sendPhase === "idle") {
			return;
		}
		if (
			phase === "running" ||
			activePendingApproval !== null ||
			activePendingUserInput !== null ||
			activeThread?.error
		) {
			resetSendPhase();
		}
	}, [
		activePendingApproval,
		activePendingUserInput,
		activeThread?.error,
		phase,
		resetSendPhase,
		sendPhase,
	]);

	useEffect(() => {
		const isTerminalFocused = (): boolean => {
			const activeElement = document.activeElement;
			if (!(activeElement instanceof HTMLElement)) return false;
			if (activeElement.classList.contains("xterm-helper-textarea"))
				return true;
			return activeElement.closest(".thread-terminal-drawer .xterm") !== null;
		};

		const handler = (event: globalThis.KeyboardEvent) => {
			if (!activeThreadId || event.defaultPrevented) return;
			const shortcutContext = {
				terminalFocus: isTerminalFocused(),
				terminalOpen: Boolean(terminalState.terminalOpen),
			};

			const command = resolveShortcutCommand(event, keybindings, {
				context: shortcutContext,
			});
			if (!command) return;

			if (command === "terminal.toggle") {
				event.preventDefault();
				event.stopPropagation();
				toggleTerminalVisibility();
				return;
			}

			if (command === "terminal.split") {
				event.preventDefault();
				event.stopPropagation();
				if (!terminalState.terminalOpen) {
					setTerminalOpen(true);
				}
				splitTerminal();
				return;
			}

			if (command === "terminal.close") {
				event.preventDefault();
				event.stopPropagation();
				if (!terminalState.terminalOpen) return;
				closeTerminal(terminalState.activeTerminalId);
				return;
			}

			if (command === "terminal.new") {
				event.preventDefault();
				event.stopPropagation();
				if (!terminalState.terminalOpen) {
					setTerminalOpen(true);
				}
				createNewTerminal();
				return;
			}

			if (command === "diff.toggle") {
				event.preventDefault();
				event.stopPropagation();
				onToggleDiff();
				return;
			}

			const scriptId = projectScriptIdFromCommand(command);
			if (!scriptId || !activeProject) return;
			const script = activeProject.scripts.find(
				(entry) => entry.id === scriptId,
			);
			if (!script) return;
			event.preventDefault();
			event.stopPropagation();
			void runProjectScript(script);
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [
		activeProject,
		terminalState.terminalOpen,
		terminalState.activeTerminalId,
		activeThreadId,
		closeTerminal,
		createNewTerminal,
		setTerminalOpen,
		runProjectScript,
		splitTerminal,
		keybindings,
		onToggleDiff,
		toggleTerminalVisibility,
	]);

	const addComposerImages = (files: File[]) => {
		if (!activeThreadId || files.length === 0) return;

		const nextImages: ComposerImageAttachment[] = [];
		let nextImageCount = composerImagesRef.current.length;
		let error: string | null = null;
		for (const file of files) {
			if (!file.type.startsWith("image/")) {
				error = `Unsupported file type for '${file.name}'. Please attach image files only.`;
				continue;
			}
			if (file.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
				error = `'${file.name}' exceeds the ${IMAGE_SIZE_LIMIT_LABEL} attachment limit.`;
				continue;
			}
			if (nextImageCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
				error = `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} images per message.`;
				break;
			}

			const previewUrl = URL.createObjectURL(file);
			nextImages.push({
				type: "image",
				id: crypto.randomUUID(),
				name: file.name || "image",
				mimeType: file.type,
				sizeBytes: file.size,
				previewUrl,
				file,
			});
			nextImageCount += 1;
		}

		if (nextImages.length === 1 && nextImages[0]) {
			addComposerImage(nextImages[0]);
		} else if (nextImages.length > 1) {
			addComposerImagesToDraft(nextImages);
		}
		setThreadError(activeThreadId, error);
	};

	const removeComposerImage = (imageId: string) => {
		removeComposerImageFromDraft(imageId);
	};

	const onComposerPaste = (event: React.ClipboardEvent<HTMLElement>) => {
		const files = Array.from(event.clipboardData.files);
		if (files.length === 0) {
			return;
		}
		const imageFiles = files.filter((file) => file.type.startsWith("image/"));
		if (imageFiles.length === 0) {
			return;
		}
		event.preventDefault();
		addComposerImages(imageFiles);
	};

	const onComposerDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
		if (!event.dataTransfer.types.includes("Files")) {
			return;
		}
		event.preventDefault();
		dragDepthRef.current += 1;
		setIsDragOverComposer(true);
	};

	const onComposerDragOver = (event: React.DragEvent<HTMLDivElement>) => {
		if (!event.dataTransfer.types.includes("Files")) {
			return;
		}
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
		setIsDragOverComposer(true);
	};

	const onComposerDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
		if (!event.dataTransfer.types.includes("Files")) {
			return;
		}
		event.preventDefault();
		const nextTarget = event.relatedTarget;
		if (
			nextTarget instanceof Node &&
			event.currentTarget.contains(nextTarget)
		) {
			return;
		}
		dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
		if (dragDepthRef.current === 0) {
			setIsDragOverComposer(false);
		}
	};

	const onComposerDrop = (event: React.DragEvent<HTMLDivElement>) => {
		if (!event.dataTransfer.types.includes("Files")) {
			return;
		}
		event.preventDefault();
		dragDepthRef.current = 0;
		setIsDragOverComposer(false);
		const files = Array.from(event.dataTransfer.files);
		addComposerImages(files);
		focusComposer();
	};

	const onRevertToTurnCount = useCallback(
		async (turnCount: number) => {
			const api = readNativeApi();
			if (!api || !activeThread || isRevertingCheckpoint) return;

			if (phase === "running" || isSendBusy || isConnecting) {
				setThreadError(
					activeThread.id,
					"Interrupt the current turn before reverting checkpoints.",
				);
				return;
			}
			const confirmed = await api.dialogs.confirm(
				[
					`Revert this thread to checkpoint ${turnCount}?`,
					"This will discard newer messages and turn diffs in this thread.",
					"This action cannot be undone.",
				].join("\n"),
			);
			if (!confirmed) {
				return;
			}

			setIsRevertingCheckpoint(true);
			setThreadError(activeThread.id, null);
			try {
				await api.orchestration.dispatchCommand({
					type: "thread.checkpoint.revert",
					commandId: newCommandId(),
					threadId: activeThread.id,
					turnCount,
					createdAt: new Date().toISOString(),
				});
			} catch (err) {
				setThreadError(
					activeThread.id,
					err instanceof Error ? err.message : "Failed to revert thread state.",
				);
			}
			setIsRevertingCheckpoint(false);
		},
		[
			activeThread,
			isConnecting,
			isRevertingCheckpoint,
			isSendBusy,
			phase,
			setThreadError,
		],
	);

	const onSend = async (
		e?: { preventDefault: () => void },
		queued?: {
			threadId: string;
			prompt: string;
			images: ComposerImageAttachment[];
		},
	) => {
		e?.preventDefault();
		const api = readNativeApi();
		if (!api || isConnecting || sendInFlightRef.current) return;

		// If we're working and this is a new message (not from queue), enqueue it
		if (isWorking && !queued && !activePendingProgress) {
			const threadId = activeThread?.id;
			if (!threadId) return;

			setPendingQueue((prev) => [
				...prev,
				{ threadId, prompt, images: [...composerImages] },
			]);

			// Clear composer for next message
			promptRef.current = "";
			setPrompt("");
			clearComposerDraftContent(threadId);
			setComposerHighlightedItemId(null);
			setComposerCursor(0);
			setComposerTrigger(null);
			return;
		}

		// Use queued data if available, otherwise use current state
		const activeThreadForSend = queued
			? threads.find((t) => t.id === queued.threadId)
			: activeThread;
		const promptForSend = queued ? queued.prompt : prompt;
		const imagesForSend = queued ? queued.images : composerImages;

		if (!activeThreadForSend || (isWorking && !activePendingProgress)) return;

		if (activePendingProgress) {
			onAdvanceActivePendingUserInput();
			return;
		}
		const trimmed = promptForSend.trim();
		if (showPlanFollowUpPrompt && activeProposedPlan) {
			const followUp = resolvePlanFollowUpSubmission({
				draftText: trimmed,
				planMarkdown: activeProposedPlan.planMarkdown,
			});
			if (!queued) {
				promptRef.current = "";
				setPrompt("");
				clearComposerDraftContent(activeThreadForSend.id);
				setComposerHighlightedItemId(null);
				setComposerCursor(0);
				setComposerTrigger(null);
			}
			await onSubmitPlanFollowUp({
				text: followUp.text,
				interactionMode: followUp.interactionMode,
			});
			return;
		}
		const standaloneSlashCommand =
			imagesForSend.length === 0
				? parseStandaloneComposerSlashCommand(trimmed)
				: null;
		if (standaloneSlashCommand) {
			await handleInteractionModeChange(standaloneSlashCommand);
			if (!queued) {
				promptRef.current = "";
				setPrompt("");
				clearComposerDraftContent(activeThreadForSend.id);
				setComposerHighlightedItemId(null);
				setComposerCursor(0);
				setComposerTrigger(null);
			}
			return;
		}
		if (!trimmed && imagesForSend.length === 0) return;
		if (!activeProject) return;
		const threadIdForSend = activeThreadForSend.id;
		const isFirstMessage =
			!isServerThread || activeThreadForSend.messages.length === 0;
		const baseBranchForWorktree =
			isFirstMessage &&
			envMode === "worktree" &&
			!activeThreadForSend.worktreePath
				? activeThreadForSend.branch
				: null;

		// In worktree mode, require an explicit base branch so we don't silently
		// fall back to local execution when branch selection is missing.
		const shouldCreateWorktree =
			isFirstMessage &&
			envMode === "worktree" &&
			!activeThreadForSend.worktreePath;
		if (shouldCreateWorktree && !activeThreadForSend.branch) {
			setStoreThreadError(
				threadIdForSend,
				"Select a base branch before sending in New worktree mode.",
			);
			return;
		}

		sendInFlightRef.current = true;
		beginSendPhase(
			baseBranchForWorktree ? "preparing-worktree" : "sending-turn",
		);

		const messageIdForSend = newMessageId();
		const messageCreatedAt = new Date().toISOString();
		const optimisticAttachments = imagesForSend.map((image) => ({
			type: "image" as const,
			id: image.id,
			name: image.name,
			mimeType: image.mimeType,
			sizeBytes: image.sizeBytes,
			previewUrl: image.previewUrl,
		}));
		setOptimisticUserMessages((existing) => [
			...existing,
			{
				id: messageIdForSend,
				role: "user",
				text: trimmed,
				...(optimisticAttachments.length > 0
					? { attachments: optimisticAttachments }
					: {}),
				createdAt: messageCreatedAt,
				streaming: false,
			},
		]);
		// Sending a message should always bring the latest user turn into view.
		shouldAutoScrollRef.current = true;
		forceStickToBottom();

		setThreadError(threadIdForSend, null);
		if (!queued) {
			promptRef.current = "";
			setPrompt("");
			clearComposerDraftContent(threadIdForSend);
			setComposerHighlightedItemId(null);
			setComposerCursor(0);
			setComposerTrigger(null);
		}

		let createdServerThreadForLocalDraft = false;
		let turnStartSucceeded = false;
		let nextThreadBranch = activeThreadForSend.branch;
		let nextThreadWorktreePath = activeThreadForSend.worktreePath;
		await (async () => {
			// On first message: lock in branch + create worktree if needed.
			if (baseBranchForWorktree) {
				beginSendPhase("preparing-worktree");
				const newBranch = buildTemporaryWorktreeBranchName();
				const result = await createWorktreeMutation.mutateAsync({
					cwd: activeProject.cwd,
					branch: baseBranchForWorktree,
					newBranch,
				});
				nextThreadBranch = result.worktree.branch;
				nextThreadWorktreePath = result.worktree.path;
				if (isServerThread) {
					await api.orchestration.dispatchCommand({
						type: "thread.meta.update",
						commandId: newCommandId(),
						threadId: threadIdForSend,
						branch: nextThreadBranch,
						worktreePath: nextThreadWorktreePath,
					});
					// Keep local thread state in sync immediately so terminal drawer opens
					// with the worktree cwd/env instead of briefly using the project root.
					setStoreThreadBranch(
						threadIdForSend,
						result.worktree.branch,
						result.worktree.path,
					);
				}
			}

			let firstComposerImageName: string | null = null;
			if (imagesForSend.length > 0) {
				const firstComposerImage = imagesForSend[0];
				if (firstComposerImage) {
					firstComposerImageName = firstComposerImage.name;
				}
			}
			let titleSeed = trimmed;
			if (!titleSeed) {
				if (firstComposerImageName) {
					titleSeed = `Image: ${firstComposerImageName}`;
				} else {
					titleSeed = "New thread";
				}
			}
			const title = truncateTitle(titleSeed);
			const threadCreateModel: ModelSlug =
				selectedModel ||
				(activeProject.model as ModelSlug) ||
				DEFAULT_MODEL_BY_PROVIDER.codex;

			if (isLocalDraftThread) {
				await api.orchestration.dispatchCommand({
					type: "thread.create",
					commandId: newCommandId(),
					threadId: threadIdForSend,
					projectId: activeProject.id,
					title,
					model: threadCreateModel,
					runtimeMode,
					interactionMode: effectiveInteractionMode,
					branch: nextThreadBranch,
					worktreePath: nextThreadWorktreePath,
					createdAt: activeThreadForSend.createdAt,
				});
				createdServerThreadForLocalDraft = true;
			}

			let setupScript: ProjectScript | null = null;
			if (baseBranchForWorktree) {
				setupScript = setupProjectScript(activeProject.scripts);
			}
			if (setupScript) {
				let shouldRunSetupScript = false;
				if (isServerThread) {
					shouldRunSetupScript = true;
				} else {
					if (createdServerThreadForLocalDraft) {
						shouldRunSetupScript = true;
					}
				}
				if (shouldRunSetupScript) {
					const setupScriptOptions: Parameters<typeof runProjectScript>[1] = {
						worktreePath: nextThreadWorktreePath,
						rememberAsLastInvoked: false,
						allowLocalDraftThread: createdServerThreadForLocalDraft,
					};
					if (nextThreadWorktreePath) {
						setupScriptOptions.cwd = nextThreadWorktreePath;
					}
					await runProjectScript(setupScript, setupScriptOptions);
				}
			}

			// Auto-title from first message
			if (isFirstMessage && isServerThread) {
				await api.orchestration.dispatchCommand({
					type: "thread.meta.update",
					commandId: newCommandId(),
					threadId: threadIdForSend,
					title,
				});
			}

			if (isServerThread) {
				await persistThreadSettingsForNextTurn({
					threadId: threadIdForSend,
					createdAt: messageCreatedAt,
					...(selectedModel ? { model: selectedModel } : {}),
					runtimeMode,
					interactionMode: effectiveInteractionMode,
				});
			}

			const turnAttachments = await Promise.all(
				imagesForSend.map(async (image) => ({
					type: "image" as const,
					name: image.name,
					mimeType: image.mimeType,
					sizeBytes: image.sizeBytes,
					dataUrl: await readFileAsDataUrl(image.file),
				})),
			);

			beginSendPhase("sending-turn");
			await api.orchestration.dispatchCommand({
				type: "thread.turn.start",
				commandId: newCommandId(),
				threadId: threadIdForSend,
				message: {
					messageId: messageIdForSend,
					role: "user",
					text: trimmed || IMAGE_ONLY_BOOTSTRAP_PROMPT,
					attachments: turnAttachments,
				},
				model: selectedModel || undefined,
				serviceTier: selectedServiceTier,
				...(selectedModelOptionsForDispatch
					? { modelOptions: selectedModelOptionsForDispatch }
					: {}),
				...(selectedProviderStartOptions
					? { providerOptions: selectedProviderStartOptions }
					: {}),
				provider: selectedProvider,
				assistantDeliveryMode: settings.enableAssistantStreaming
					? "streaming"
					: "buffered",
				runtimeMode,
				interactionMode: effectiveInteractionMode,
				createdAt: messageCreatedAt,
			});
			turnStartSucceeded = true;
		})().catch(async (err: unknown) => {
			if (createdServerThreadForLocalDraft && !turnStartSucceeded) {
				await api.orchestration
					.dispatchCommand({
						type: "thread.delete",
						commandId: newCommandId(),
						threadId: threadIdForSend,
					})
					.catch(() => undefined);
			}
			if (
				!turnStartSucceeded &&
				promptRef.current.length === 0 &&
				composerImagesRef.current.length === 0
			) {
				setOptimisticUserMessages((existing) => {
					const removed = existing.filter(
						(message) => message.id === messageIdForSend,
					);
					for (const message of removed) {
						revokeUserMessagePreviewUrls(message);
					}
					const next = existing.filter(
						(message) => message.id !== messageIdForSend,
					);
					return next.length === existing.length ? existing : next;
				});
				promptRef.current = trimmed;
				setPrompt(trimmed);
				setComposerCursor(trimmed.length);
				addComposerImagesToDraft(imagesForSend.map(cloneComposerImageForRetry));
				setComposerTrigger(detectComposerTrigger(trimmed, trimmed.length));
			}
			setThreadError(
				threadIdForSend,
				err instanceof Error ? err.message : "Failed to send message.",
			);
		});
		sendInFlightRef.current = false;
		if (!turnStartSucceeded) {
			resetSendPhase();
		}
	};

	const flushPendingQueuedSend = useEffectEvent(
		(next: (typeof pendingQueue)[number]) => {
			setPendingQueue((prev) => prev.slice(1));
			void onSend(undefined, next);
		},
	);

	useEffect(() => {
		if (isWorking || pendingQueue.length === 0 || sendInFlightRef.current) {
			return;
		}

		const next = pendingQueue[0];
		if (!next) return;
		flushPendingQueuedSend(next);
	}, [isWorking, pendingQueue]);

	const onInterrupt = async () => {
		const api = readNativeApi();
		if (!api || !activeThread) return;
		await api.orchestration.dispatchCommand({
			type: "thread.turn.interrupt",
			commandId: newCommandId(),
			threadId: activeThread.id,
			createdAt: new Date().toISOString(),
		});
	};

	const onRespondToApproval = useCallback(
		async (
			requestId: ApprovalRequestId,
			decision: ProviderApprovalDecision,
		) => {
			const api = readNativeApi();
			if (!api || !activeThreadId) return;

			setRespondingRequestIds((existing) =>
				existing.includes(requestId) ? existing : [...existing, requestId],
			);
			await api.orchestration
				.dispatchCommand({
					type: "thread.approval.respond",
					commandId: newCommandId(),
					threadId: activeThreadId,
					requestId,
					decision,
					createdAt: new Date().toISOString(),
				})
				.catch((err: unknown) => {
					setStoreThreadError(
						activeThreadId,
						err instanceof Error
							? err.message
							: "Failed to submit approval decision.",
					);
				});
			setRespondingRequestIds((existing) =>
				existing.filter((id) => id !== requestId),
			);
		},
		[activeThreadId, setStoreThreadError],
	);

	const onRespondToUserInput = useCallback(
		async (requestId: ApprovalRequestId, answers: Record<string, unknown>) => {
			const api = readNativeApi();
			if (!api || !activeThreadId) return;

			setRespondingUserInputRequestIds((existing) =>
				existing.includes(requestId) ? existing : [...existing, requestId],
			);
			await api.orchestration
				.dispatchCommand({
					type: "thread.user-input.respond",
					commandId: newCommandId(),
					threadId: activeThreadId,
					requestId,
					answers,
					createdAt: new Date().toISOString(),
				})
				.catch((err: unknown) => {
					setStoreThreadError(
						activeThreadId,
						err instanceof Error ? err.message : "Failed to submit user input.",
					);
				});
			setRespondingUserInputRequestIds((existing) =>
				existing.filter((id) => id !== requestId),
			);
		},
		[activeThreadId, setStoreThreadError],
	);

	const setActivePendingUserInputQuestionIndex = useCallback(
		(nextQuestionIndex: number) => {
			if (!activePendingUserInput) {
				return;
			}
			setPendingUserInputQuestionIndexByRequestId((existing) => ({
				...existing,
				[activePendingUserInput.requestId]: nextQuestionIndex,
			}));
		},
		[activePendingUserInput],
	);

	const onSelectActivePendingUserInputOption = useCallback(
		(questionId: string, optionLabel: string) => {
			if (!activePendingUserInput) {
				return;
			}
			setPendingUserInputAnswersByRequestId((existing) => ({
				...existing,
				[activePendingUserInput.requestId]: {
					...existing[activePendingUserInput.requestId],
					[questionId]: {
						selectedOptionLabel: optionLabel,
						customAnswer: "",
					},
				},
			}));
			promptRef.current = "";
			setComposerCursor(0);
			setComposerTrigger(null);
		},
		[activePendingUserInput],
	);

	const onChangeActivePendingUserInputCustomAnswer = useCallback(
		(
			questionId: string,
			value: string,
			nextCursor: number,
			cursorAdjacentToMention: boolean,
		) => {
			if (!activePendingUserInput) {
				return;
			}
			promptRef.current = value;
			setPendingUserInputAnswersByRequestId((existing) => ({
				...existing,
				[activePendingUserInput.requestId]: {
					...existing[activePendingUserInput.requestId],
					[questionId]: setPendingUserInputCustomAnswer(
						existing[activePendingUserInput.requestId]?.[questionId],
						value,
					),
				},
			}));
			setComposerCursor(nextCursor);
			setComposerTrigger(
				cursorAdjacentToMention
					? null
					: detectComposerTrigger(
							value,
							expandCollapsedComposerCursor(value, nextCursor),
						),
			);
		},
		[activePendingUserInput],
	);

	const onAdvanceActivePendingUserInput = useCallback(() => {
		if (!activePendingUserInput || !activePendingProgress) {
			return;
		}
		if (activePendingProgress.isLastQuestion) {
			if (activePendingResolvedAnswers) {
				void onRespondToUserInput(
					activePendingUserInput.requestId,
					activePendingResolvedAnswers,
				);
			}
			return;
		}
		setActivePendingUserInputQuestionIndex(
			activePendingProgress.questionIndex + 1,
		);
	}, [
		activePendingProgress,
		activePendingResolvedAnswers,
		activePendingUserInput,
		onRespondToUserInput,
		setActivePendingUserInputQuestionIndex,
	]);

	const onPreviousActivePendingUserInputQuestion = useCallback(() => {
		if (!activePendingProgress) {
			return;
		}
		setActivePendingUserInputQuestionIndex(
			Math.max(activePendingProgress.questionIndex - 1, 0),
		);
	}, [activePendingProgress, setActivePendingUserInputQuestionIndex]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: shouldAutoScrollRef is a stable ref object
	const onSubmitPlanFollowUp = useCallback(
		async ({
			text,
			interactionMode: nextInteractionMode,
		}: {
			text: string;
			interactionMode: "default" | "plan";
		}) => {
			const api = readNativeApi();
			if (
				!api ||
				!activeThread ||
				!isServerThread ||
				isSendBusy ||
				isConnecting ||
				sendInFlightRef.current
			) {
				return;
			}

			const trimmed = text.trim();
			if (!trimmed) {
				return;
			}

			const threadIdForSend = activeThread.id;
			const messageIdForSend = newMessageId();
			const messageCreatedAt = new Date().toISOString();

			sendInFlightRef.current = true;
			beginSendPhase("sending-turn");
			setThreadError(threadIdForSend, null);
			setOptimisticUserMessages((existing) => [
				...existing,
				{
					id: messageIdForSend,
					role: "user",
					text: trimmed,
					createdAt: messageCreatedAt,
					streaming: false,
				},
			]);
			shouldAutoScrollRef.current = true;
			forceStickToBottom();

			const effectiveNextInteractionMode: ProviderInteractionMode =
				selectedProvider === "gemini" ? "default" : nextInteractionMode;

			try {
				await persistThreadSettingsForNextTurn({
					threadId: threadIdForSend,
					createdAt: messageCreatedAt,
					...(selectedModel ? { model: selectedModel } : {}),
					runtimeMode,
					interactionMode: effectiveNextInteractionMode,
				});

				// Keep the mode toggle and plan-follow-up banner in sync immediately
				// while the same-thread implementation turn is starting.
				setComposerDraftInteractionMode(threadIdForSend, nextInteractionMode);
				if (nextInteractionMode === "default") {
					planSidebarDismissedForTurnRef.current = null;
					setPlanSidebarOpen(true);
				}

				await api.orchestration.dispatchCommand({
					type: "thread.turn.start",
					commandId: newCommandId(),
					threadId: threadIdForSend,
					message: {
						messageId: messageIdForSend,
						role: "user",
						text: trimmed,
						attachments: [],
					},
					provider: selectedProvider,
					model: selectedModel || undefined,
					...(selectedModelOptionsForDispatch
						? { modelOptions: selectedModelOptionsForDispatch }
						: {}),
					...(selectedProviderStartOptions
						? { providerOptions: selectedProviderStartOptions }
						: {}),
					assistantDeliveryMode: settings.enableAssistantStreaming
						? "streaming"
						: "buffered",
					runtimeMode,
					interactionMode: effectiveNextInteractionMode,
					createdAt: messageCreatedAt,
				});
				sendInFlightRef.current = false;
			} catch (err) {
				setOptimisticUserMessages((existing) =>
					existing.filter((message) => message.id !== messageIdForSend),
				);
				setThreadError(
					threadIdForSend,
					err instanceof Error ? err.message : "Failed to send plan follow-up.",
				);
				sendInFlightRef.current = false;
				resetSendPhase();
			}
		},
		[
			activeThread,
			beginSendPhase,
			forceStickToBottom,
			isConnecting,
			isSendBusy,
			isServerThread,
			persistThreadSettingsForNextTurn,
			resetSendPhase,
			runtimeMode,
			selectedModel,
			selectedModelOptionsForDispatch,
			selectedProvider,
			selectedProviderStartOptions,
			setComposerDraftInteractionMode,
			setThreadError,
			settings.enableAssistantStreaming,
		],
	);

	const onImplementPlanInNewThread = useCallback(async () => {
		const api = readNativeApi();
		if (
			!api ||
			!activeThread ||
			!activeProject ||
			!activeProposedPlan ||
			!isServerThread ||
			isSendBusy ||
			isConnecting ||
			sendInFlightRef.current
		) {
			return;
		}

		const createdAt = new Date().toISOString();
		const nextThreadId = newThreadId();
		const planMarkdown = activeProposedPlan.planMarkdown;
		const implementationPrompt = buildPlanImplementationPrompt(planMarkdown);
		const nextThreadTitle = truncateTitle(
			buildPlanImplementationThreadTitle(planMarkdown),
		);
		const nextThreadModel: ModelSlug =
			implementationModel ||
			(activeThread.model as ModelSlug) ||
			(activeProject.model as ModelSlug) ||
			DEFAULT_MODEL_BY_PROVIDER[implementationProvider];

		sendInFlightRef.current = true;
		beginSendPhase("sending-turn");
		const finish = () => {
			sendInFlightRef.current = false;
			resetSendPhase();
		};

		await api.orchestration
			.dispatchCommand({
				type: "thread.create",
				commandId: newCommandId(),
				threadId: nextThreadId,
				projectId: activeProject.id,
				title: nextThreadTitle,
				model: nextThreadModel,
				runtimeMode,
				interactionMode: "default",
				branch: activeThread.branch,
				worktreePath: activeThread.worktreePath,
				createdAt,
			})
			.then(() =>
				api.orchestration.dispatchCommand({
					type: "thread.turn.start",
					commandId: newCommandId(),
					threadId: nextThreadId,
					message: {
						messageId: newMessageId(),
						role: "user",
						text: implementationPrompt,
						attachments: [],
					},
					provider: implementationProvider,
					model: implementationModel || undefined,
					...(implementationModelOptionsForDispatch
						? { modelOptions: implementationModelOptionsForDispatch }
						: {}),
					...(implementationProviderStartOptions
						? { providerOptions: implementationProviderStartOptions }
						: {}),
					assistantDeliveryMode: settings.enableAssistantStreaming
						? "streaming"
						: "buffered",
					runtimeMode,
					interactionMode: "default",
					createdAt,
				}),
			)
			.then(() => api.orchestration.getSnapshot())
			.then((snapshot) => {
				syncServerReadModel(snapshot);
				planSidebarOpenOnNextThreadRef.current = true;
				return navigate({
					to: "/$threadId",
					params: { threadId: nextThreadId },
				});
			})
			.catch(async (err) => {
				await api.orchestration
					.dispatchCommand({
						type: "thread.delete",
						commandId: newCommandId(),
						threadId: nextThreadId,
					})
					.catch(() => undefined);
				await api.orchestration
					.getSnapshot()
					.then((snapshot) => {
						syncServerReadModel(snapshot);
					})
					.catch(() => undefined);
				toastManager.add({
					type: "error",
					title: "Could not start implementation thread",
					description:
						err instanceof Error
							? err.message
							: "An error occurred while creating the new thread.",
				});
			})
			.then(finish, finish);
	}, [
		activeProject,
		activeProposedPlan,
		activeThread,
		beginSendPhase,
		isConnecting,
		isSendBusy,
		isServerThread,
		implementationModel,
		implementationModelOptionsForDispatch,
		implementationProvider,
		implementationProviderStartOptions,
		navigate,
		resetSendPhase,
		runtimeMode,
		settings.enableAssistantStreaming,
		syncServerReadModel,
	]);

	const onProviderModelSelect = useCallback(
		(provider: ProviderKind, model: ModelSlug) => {
			if (!activeThread) return;
			if (lockedProvider !== null && provider !== lockedProvider) {
				scheduleComposerFocus();
				return;
			}
			setComposerDraftProvider(activeThread.id, provider);
			setComposerDraftModel(
				activeThread.id,
				resolveAppModelSelection(
					provider,
					getCustomModelsForProvider(settings, provider),
					model,
				),
			);
			scheduleComposerFocus();
		},
		[
			activeThread,
			scheduleComposerFocus,
			setComposerDraftModel,
			setComposerDraftProvider,
			settings,
		],
	);
	const onImplementationProviderModelChange = useCallback(
		(provider: ProviderKind, model: ModelSlug) => {
			setImplementationProvider(provider);
			setImplementationModel(
				resolveAppModelSelection(
					provider,
					getCustomModelsForProvider(settings, provider),
					model,
				) as ModelSlug,
			);
		},
		[settings],
	);
	const onHandOffInThread = useCallback(
		(params: {
			provider: ProviderKind;
			model: ModelSlug;
			planMarkdown: string;
		}) => {
			if (!activeThread) return;
			const { provider, model, planMarkdown } = params;
			const implementationText = buildPlanImplementationPrompt(planMarkdown);
			setComposerDraftProvider(threadId, provider);
			setComposerDraftModel(
				threadId,
				resolveAppModelSelection(
					provider,
					getCustomModelsForProvider(settings, provider),
					model,
				),
			);
			setComposerDraftPrompt(threadId, implementationText);
			promptRef.current = implementationText;
			setComposerCursor(implementationText.length);
			setComposerTrigger(
				detectComposerTrigger(implementationText, implementationText.length),
			);
			setPlanSidebarOpen(false);
			scheduleComposerFocus();
		},
		[
			activeThread,
			scheduleComposerFocus,
			setComposerDraftModel,
			setComposerDraftPrompt,
			setComposerDraftProvider,
			settings,
			threadId,
		],
	);
	const onEffortSelect = useCallback(
		(effort: CodexReasoningEffort) => {
			setComposerDraftEffort(threadId, effort);
			scheduleComposerFocus();
		},
		[scheduleComposerFocus, setComposerDraftEffort, threadId],
	);
	const onCodexFastModeChange = useCallback(
		(enabled: boolean) => {
			setComposerDraftCodexFastMode(threadId, enabled);
			scheduleComposerFocus();
		},
		[scheduleComposerFocus, setComposerDraftCodexFastMode, threadId],
	);
	const onEnvModeChange = useCallback(
		(mode: DraftThreadEnvMode) => {
			if (isLocalDraftThread) {
				setDraftThreadContext(threadId, { envMode: mode });
			}
			scheduleComposerFocus();
		},
		[
			isLocalDraftThread,
			scheduleComposerFocus,
			setDraftThreadContext,
			threadId,
		],
	);

	const applyPromptReplacement = useCallback(
		(
			rangeStart: number,
			rangeEnd: number,
			replacement: string,
			options?: { expectedText?: string },
		): boolean => {
			const currentText = promptRef.current;
			const safeStart = Math.max(0, Math.min(currentText.length, rangeStart));
			const safeEnd = Math.max(
				safeStart,
				Math.min(currentText.length, rangeEnd),
			);
			if (
				options?.expectedText !== undefined &&
				currentText.slice(safeStart, safeEnd) !== options.expectedText
			) {
				return false;
			}
			const next = replaceTextRange(
				promptRef.current,
				rangeStart,
				rangeEnd,
				replacement,
			);
			promptRef.current = next.text;
			const activePendingQuestion = activePendingProgress?.activeQuestion;
			if (activePendingQuestion && activePendingUserInput) {
				setPendingUserInputAnswersByRequestId((existing) => ({
					...existing,
					[activePendingUserInput.requestId]: {
						...existing[activePendingUserInput.requestId],
						[activePendingQuestion.id]: setPendingUserInputCustomAnswer(
							existing[activePendingUserInput.requestId]?.[
								activePendingQuestion.id
							],
							next.text,
						),
					},
				}));
			} else {
				setPrompt(next.text);
			}
			setComposerCursor(next.cursor);
			setComposerTrigger(detectComposerTrigger(next.text, next.cursor));
			window.requestAnimationFrame(() => {
				composerEditorRef.current?.focusAt(next.cursor);
			});
			return true;
		},
		[activePendingProgress?.activeQuestion, activePendingUserInput, setPrompt],
	);

	const readComposerSnapshot = useCallback((): {
		value: string;
		cursor: number;
	} => {
		const editorSnapshot = composerEditorRef.current?.readSnapshot();
		if (editorSnapshot) {
			return editorSnapshot;
		}
		return { value: promptRef.current, cursor: composerCursor };
	}, [composerCursor]);

	const resolveActiveComposerTrigger = useCallback((): {
		snapshot: { value: string; cursor: number };
		trigger: ComposerTrigger | null;
	} => {
		const snapshot = readComposerSnapshot();
		const expandedCursor = expandCollapsedComposerCursor(
			snapshot.value,
			snapshot.cursor,
		);
		return {
			snapshot,
			trigger: detectComposerTrigger(snapshot.value, expandedCursor),
		};
	}, [readComposerSnapshot]);

	const onSelectComposerItem = useCallback(
		(item: ComposerCommandItem) => {
			if (composerSelectLockRef.current) return;
			composerSelectLockRef.current = true;
			window.requestAnimationFrame(() => {
				composerSelectLockRef.current = false;
			});
			const { snapshot, trigger } = resolveActiveComposerTrigger();
			if (!trigger) return;
			const expectedToken = snapshot.value.slice(
				trigger.rangeStart,
				trigger.rangeEnd,
			);
			if (item.type === "path") {
				const applied = applyPromptReplacement(
					trigger.rangeStart,
					trigger.rangeEnd,
					`@${item.path} `,
					{ expectedText: expectedToken },
				);
				if (applied) {
					setComposerHighlightedItemId(null);
				}
				return;
			}
			if (item.type === "slash-command") {
				if (item.command === "model") {
					const applied = applyPromptReplacement(
						trigger.rangeStart,
						trigger.rangeEnd,
						"/model ",
						{
							expectedText: expectedToken,
						},
					);
					if (applied) {
						setComposerHighlightedItemId(null);
					}
					return;
				}
				void handleInteractionModeChange(
					item.command === "plan" ? "plan" : "default",
				);
				const applied = applyPromptReplacement(
					trigger.rangeStart,
					trigger.rangeEnd,
					"",
					{
						expectedText: expectedToken,
					},
				);
				if (applied) {
					setComposerHighlightedItemId(null);
				}
				return;
			}
			onProviderModelSelect(item.provider, item.model);
			const applied = applyPromptReplacement(
				trigger.rangeStart,
				trigger.rangeEnd,
				"",
				{
					expectedText: expectedToken,
				},
			);
			if (applied) {
				setComposerHighlightedItemId(null);
			}
		},
		[
			applyPromptReplacement,
			handleInteractionModeChange,
			onProviderModelSelect,
			resolveActiveComposerTrigger,
		],
	);
	const onComposerMenuItemHighlighted = useCallback((itemId: string | null) => {
		setComposerHighlightedItemId(itemId);
	}, []);
	const nudgeComposerMenuHighlight = useCallback(
		(key: "ArrowDown" | "ArrowUp") => {
			if (composerMenuItems.length === 0) {
				return;
			}
			const highlightedIndex = composerMenuItems.findIndex(
				(item) => item.id === composerHighlightedItemId,
			);
			const normalizedIndex =
				highlightedIndex >= 0 ? highlightedIndex : key === "ArrowDown" ? -1 : 0;
			const offset = key === "ArrowDown" ? 1 : -1;
			const nextIndex =
				(normalizedIndex + offset + composerMenuItems.length) %
				composerMenuItems.length;
			const nextItem = composerMenuItems[nextIndex];
			setComposerHighlightedItemId(nextItem?.id ?? null);
		},
		[composerHighlightedItemId, composerMenuItems],
	);
	const isComposerMenuLoading =
		composerTriggerKind === "path" &&
		((pathTriggerQuery.length > 0 &&
			composerPathQueryDebouncer.state.isPending) ||
			workspaceEntriesQuery.isLoading ||
			workspaceEntriesQuery.isFetching);

	const onPromptChange = useCallback(
		(
			nextPrompt: string,
			nextCursor: number,
			cursorAdjacentToMention: boolean,
		) => {
			if (activePendingProgress?.activeQuestion && activePendingUserInput) {
				onChangeActivePendingUserInputCustomAnswer(
					activePendingProgress.activeQuestion.id,
					nextPrompt,
					nextCursor,
					cursorAdjacentToMention,
				);
				return;
			}
			promptRef.current = nextPrompt;
			setPrompt(nextPrompt);
			setComposerCursor(nextCursor);
			setComposerTrigger(
				cursorAdjacentToMention
					? null
					: detectComposerTrigger(
							nextPrompt,
							expandCollapsedComposerCursor(nextPrompt, nextCursor),
						),
			);
		},
		[
			activePendingProgress?.activeQuestion,
			activePendingUserInput,
			onChangeActivePendingUserInputCustomAnswer,
			setPrompt,
		],
	);

	const onComposerCommandKey = (
		key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab",
		event: KeyboardEvent,
	) => {
		if (key === "Tab" && event.shiftKey) {
			toggleInteractionMode();
			return true;
		}

		const { trigger } = resolveActiveComposerTrigger();
		const menuIsActive = composerMenuOpenRef.current || trigger !== null;

		if (menuIsActive) {
			const currentItems = composerMenuItemsRef.current;
			if (key === "ArrowDown" && currentItems.length > 0) {
				nudgeComposerMenuHighlight("ArrowDown");
				return true;
			}
			if (key === "ArrowUp" && currentItems.length > 0) {
				nudgeComposerMenuHighlight("ArrowUp");
				return true;
			}
			if (key === "Tab" || key === "Enter") {
				const selectedItem =
					activeComposerMenuItemRef.current ?? currentItems[0];
				if (selectedItem) {
					onSelectComposerItem(selectedItem);
					return true;
				}
			}
		}

		if (key === "Enter" && !event.shiftKey) {
			void onSend();
			return true;
		}
		return false;
	};
	const onToggleWorkGroup = useCallback((groupId: string) => {
		setExpandedWorkGroups((existing) => ({
			...existing,
			[groupId]: !existing[groupId],
		}));
	}, []);
	const onExpandTimelineImage = useCallback((preview: ExpandedImagePreview) => {
		setExpandedImage(preview);
	}, []);
	const expandedImageItem = expandedImage
		? expandedImage.images[expandedImage.index]
		: null;
	const onOpenTurnDiff = useCallback(
		(turnId: TurnId, filePath?: string) => {
			void navigate({
				to: "/$threadId",
				params: { threadId },
				search: (previous) => {
					const rest = stripSettingsTabSearchParams(
						stripProjectDockSearchParams(stripDiffSearchParams(previous)),
					);
					return filePath
						? { ...rest, diff: "1", diffTurnId: turnId, diffFilePath: filePath }
						: { ...rest, diff: "1", diffTurnId: turnId };
				},
			});
		},
		[navigate, threadId],
	);
	const onRevertUserMessage = (messageId: MessageId) => {
		const targetTurnCount = revertTurnCountByUserMessageId.get(messageId);
		if (typeof targetTurnCount !== "number") {
			return;
		}
		void onRevertToTurnCount(targetTurnCount);
	};

	// Empty state: no active thread
	if (!activeThread) {
		return (
			<div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-muted-foreground/40">
				{!isDesktopShell && (
					<header className="border-b border-border px-3 py-2 md:hidden">
						<div className="flex items-center gap-2">
							<SidebarTrigger className="size-7 shrink-0" />
							<span className="text-sm font-medium text-foreground">
								Threads
							</span>
						</div>
					</header>
				)}
				{isDesktopShell && (
					<div className="drag-region flex h-13 shrink-0 items-center border-b border-border px-5">
						<span className="text-xs text-muted-foreground/50">
							No active thread
						</span>
					</div>
				)}
				<div className="flex flex-1 items-center justify-center">
					<div className="text-center">
						<p className="text-sm">
							Select a thread or create a new one to get started.
						</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
			{/* Top bar */}
			<Toolbar
				activeThreadId={activeThread.id}
				activeThreadTitle={activeThread.title}
				activeProjectName={activeProject?.name}
				isGitRepo={isGitRepo}
				openInCwd={activeThread.worktreePath ?? activeProject?.cwd ?? null}
				activeProjectScripts={activeProject?.scripts}
				preferredScriptId={
					activeProject
						? (lastInvokedScriptByProjectId[activeProject.id] ?? null)
						: null
				}
				keybindings={keybindings}
				availableEditors={availableEditors}
				diffToggleShortcutLabel={diffPanelShortcutLabel}
				gitCwd={gitCwd}
				diffOpen={diffOpen}
				projectDockOpen={projectDockOpen}
				onRunProjectScript={(script) => {
					void runProjectScript(script);
				}}
				onAddProjectScript={saveProjectScript}
				onUpdateProjectScript={updateProjectScript}
				onToggleDiff={onToggleDiff}
				onToggleProjectDock={onToggleProjectDock}
				isDesktopShell={isDesktopShell}
				providerStatus={activeProviderStatus}
				threadError={activeThread.error}
			/>

			<div className="flex min-h-0 min-w-0 flex-1">
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					<MessageList
						scrollContainerRef={setMessagesScrollContainerRef}
						onScroll={onMessagesScroll}
						onClickCapture={onMessagesClickCapture}
						onWheel={onMessagesWheel}
						onPointerDown={onMessagesPointerDown}
						onPointerUp={onMessagesPointerUp}
						onPointerCancel={onMessagesPointerCancel}
						onTouchStart={onMessagesTouchStart}
						onTouchMove={onMessagesTouchMove}
						onTouchEnd={onMessagesTouchEnd}
						hasMessages={timelineEntries.length > 0}
						isWorking={isWorking}
						activeProvider={activeProvider}
						activeTurnInProgress={isWorking || !latestTurnSettled}
						activeTurnStartedAt={activeWorkStartedAt}
						scrollContainer={messagesScrollElement}
						timelineEntries={timelineEntries}
						completionDividerBeforeEntryId={completionDividerBeforeEntryId}
						completionSummary={completionSummary}
						turnDiffSummaryByAssistantMessageId={
							turnDiffSummaryByAssistantMessageId
						}
						nowIso={nowIso}
						expandedWorkGroups={expandedWorkGroups}
						onToggleWorkGroup={onToggleWorkGroup}
						onOpenTurnDiff={onOpenTurnDiff}
						revertTurnCountByUserMessageId={revertTurnCountByUserMessageId}
						onRevertUserMessage={onRevertUserMessage}
						isRevertingCheckpoint={isRevertingCheckpoint}
						onImageExpand={onExpandTimelineImage}
						markdownCwd={gitCwd ?? undefined}
						resolvedTheme={resolvedTheme}
						workspaceRoot={activeProject?.cwd ?? undefined}
					/>

					<ComposerArea
						formRef={composerFormRef}
						onSubmit={onSend}
						isGitRepo={isGitRepo}
						isDragOverComposer={isDragOverComposer}
						onDragEnter={onComposerDragEnter}
						onDragOver={onComposerDragOver}
						onDragLeave={onComposerDragLeave}
						onDrop={onComposerDrop}
						activePendingApproval={activePendingApproval}
						pendingApprovalsCount={pendingApprovals.length}
						pendingUserInputs={pendingUserInputs}
						respondingUserInputRequestIds={respondingUserInputRequestIds}
						activePendingDraftAnswers={activePendingDraftAnswers}
						activePendingQuestionIndex={activePendingQuestionIndex}
						onSelectActivePendingUserInputOption={
							onSelectActivePendingUserInputOption
						}
						showPlanFollowUpPrompt={showPlanFollowUpPrompt}
						activeProposedPlan={activeProposedPlan}
						hasComposerHeader={hasComposerHeader}
						composerMenuOpen={composerMenuOpen}
						isComposerApprovalState={isComposerApprovalState}
						composerMenuItems={composerMenuItems}
						resolvedTheme={resolvedTheme}
						isComposerMenuLoading={isComposerMenuLoading}
						composerTriggerKind={composerTriggerKind}
						activeComposerMenuItemId={activeComposerMenuItem?.id ?? null}
						onComposerMenuItemHighlighted={onComposerMenuItemHighlighted}
						onSelectComposerItem={onSelectComposerItem}
						composerImages={composerImages}
						onExpandImage={setExpandedImage}
						nonPersistedComposerImageIdSet={nonPersistedComposerImageIdSet}
						removeComposerImage={removeComposerImage}
						composerEditorRef={composerEditorRef}
						composerValue={
							isComposerApprovalState
								? ""
								: activePendingProgress
									? activePendingProgress.customAnswer
									: prompt
						}
						composerCursor={composerCursor}
						onPromptChange={onPromptChange}
						onComposerCommandKey={onComposerCommandKey}
						onComposerPaste={onComposerPaste}
						placeholder={
							isComposerApprovalState
								? (activePendingApproval?.detail ??
									"Resolve this approval request to continue")
								: activePendingProgress
									? "Type your own answer, or leave this blank to use the selected option"
									: showPlanFollowUpPrompt && activeProposedPlan
										? "Add feedback to refine the plan, or leave this blank to implement it"
										: phase === "disconnected"
											? "Ask for follow-up changes or attach images"
											: "Ask anything, @tag files/folders, or use /model"
						}
						isConnecting={isConnecting}
						selectedProvider={selectedProvider}
						selectedModelForPickerWithCustomFallback={
							selectedModelForPickerWithCustomFallback
						}
						lockedProvider={lockedProvider}
						modelOptionsByProvider={modelOptionsByProvider}
						availableProviders={availableProviderOptions}
						selectedServiceTierSetting={selectedServiceTierSetting}
						onProviderModelSelect={onProviderModelSelect}
						selectedEffort={selectedEffort}
						selectedCodexFastModeEnabled={selectedCodexFastModeEnabled}
						reasoningOptions={reasoningOptions}
						onEffortSelect={onEffortSelect}
						onCodexFastModeChange={onCodexFastModeChange}
						planModeSupported={selectedProvider !== "gemini"}
						interactionMode={interactionMode}
						toggleInteractionMode={toggleInteractionMode}
						runtimeMode={runtimeMode}
						handleRuntimeModeChange={handleRuntimeModeChange}
						isPreparingWorktree={isPreparingWorktree}
						activePendingProgress={activePendingProgress}
						activePendingIsResponding={activePendingIsResponding}
						activePendingResolvedAnswers={activePendingResolvedAnswers}
						onPreviousActivePendingUserInputQuestion={
							onPreviousActivePendingUserInputQuestion
						}
						phase={phase}
						onInterrupt={onInterrupt}
						prompt={prompt}
						isSendBusy={isSendBusy}
						onImplementPlanInNewThread={onImplementPlanInNewThread}
						respondingRequestIds={respondingRequestIds}
						onRespondToApproval={onRespondToApproval}
						planSidebarOpen={planSidebarOpen}
						showPlanSidebarToggle={
							activePlan !== null ||
							activeProposedPlan !== null ||
							planSidebarOpen
						}
						onTogglePlanSidebar={() => {
							setPlanSidebarOpen((open) => {
								if (open) {
									const turnKey =
										activePlan?.turnId ?? activeProposedPlan?.turnId ?? null;
									if (turnKey) {
										planSidebarDismissedForTurnRef.current = turnKey;
									}
								} else {
									planSidebarDismissedForTurnRef.current = null;
								}
								return !open;
							});
						}}
						onAdvanceActivePendingUserInput={onAdvanceActivePendingUserInput}
						onAppendToPrompt={handleAppendToPrompt}
						isVoiceInputSupported={isSpeechRecognitionSupported()}
						providerSwitchHint={
							sessionProvider !== null && selectedProvider !== sessionProvider
								? `Next message will use ${availableProviderOptions.find((o) => o.value === selectedProvider)?.label ?? selectedProvider}`
								: null
						}
					/>
				</div>

				{planSidebarOpen ? (
					<PlanSidebar
						activePlan={activePlan}
						activeProposedPlan={activeProposedPlan}
						markdownCwd={gitCwd ?? undefined}
						workspaceRoot={activeProject?.cwd ?? undefined}
						onClose={() => {
							setPlanSidebarOpen(false);
							const turnKey =
								activePlan?.turnId ?? activeProposedPlan?.turnId ?? null;
							if (turnKey) {
								planSidebarDismissedForTurnRef.current = turnKey;
							}
						}}
						implementationProvider={implementationProvider}
						implementationModelForPicker={
							implementationModelForPickerWithCustomFallback
						}
						modelOptionsByProvider={modelOptionsByProvider}
						availableProviders={availableProviderOptions}
						selectedServiceTierSetting={selectedServiceTierSetting}
						onImplementationProviderModelChange={
							onImplementationProviderModelChange
						}
						threadCanSwitchProvider={threadCanSwitchProvider}
						onHandOffInThread={onHandOffInThread}
					/>
				) : null}
			</div>

			{isGitRepo && (
				<BranchToolbar
					threadId={activeThread.id}
					onEnvModeChange={onEnvModeChange}
					envLocked={envLocked}
					onComposerFocusRequest={scheduleComposerFocus}
				/>
			)}

			{(() => {
				if (!terminalState.terminalOpen || !activeProject) {
					return null;
				}
				return (
					<ThreadTerminalDrawer
						key={activeThread.id}
						threadId={activeThread.id}
						cwd={gitCwd ?? activeProject.cwd}
						runtimeEnv={threadTerminalRuntimeEnv}
						height={terminalState.terminalHeight}
						terminalIds={terminalState.terminalIds}
						activeTerminalId={terminalState.activeTerminalId}
						terminalGroups={terminalState.terminalGroups}
						activeTerminalGroupId={terminalState.activeTerminalGroupId}
						focusRequestId={terminalFocusRequestId}
						onSplitTerminal={splitTerminal}
						onNewTerminal={createNewTerminal}
						splitShortcutLabel={splitTerminalShortcutLabel ?? undefined}
						newShortcutLabel={newTerminalShortcutLabel ?? undefined}
						closeShortcutLabel={closeTerminalShortcutLabel ?? undefined}
						onActiveTerminalChange={activateTerminal}
						onCloseTerminal={closeTerminal}
						onHeightChange={setTerminalHeight}
					/>
				);
			})()}

			{expandedImage && expandedImageItem && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6 [-webkit-app-region:no-drag]"
					role="dialog"
					aria-modal="true"
					aria-label="Expanded image preview"
				>
					<button
						type="button"
						className="absolute inset-0 z-0 cursor-zoom-out"
						aria-label="Close image preview"
						onClick={closeExpandedImage}
					/>
					{expandedImage.images.length > 1 && (
						<Button
							type="button"
							size="icon"
							variant="ghost"
							className="absolute left-2 top-1/2 z-20 -translate-y-1/2 text-white/90 hover:bg-white/10 hover:text-white sm:left-6"
							aria-label="Previous image"
							onClick={() => {
								navigateExpandedImage(-1);
							}}
						>
							<ChevronLeftIcon className="size-5" />
						</Button>
					)}
					<div className="relative isolate z-10 max-h-[92vh] max-w-[92vw]">
						<Button
							type="button"
							size="icon-xs"
							variant="ghost"
							className="absolute right-2 top-2"
							onClick={closeExpandedImage}
							aria-label="Close image preview"
						>
							<XIcon />
						</Button>
						<img
							src={expandedImageItem.src}
							alt={expandedImageItem.name}
							className="max-h-[86vh] max-w-[92vw] select-none rounded-lg border border-border/70 bg-background object-contain shadow-2xl"
							draggable={false}
						/>
						<p className="mt-2 max-w-[92vw] truncate text-center text-xs text-muted-foreground/80">
							{expandedImageItem.name}
							{expandedImage.images.length > 1
								? ` (${expandedImage.index + 1}/${expandedImage.images.length})`
								: ""}
						</p>
					</div>
					{expandedImage.images.length > 1 && (
						<Button
							type="button"
							size="icon"
							variant="ghost"
							className="absolute right-2 top-1/2 z-20 -translate-y-1/2 text-white/90 hover:bg-white/10 hover:text-white sm:right-6"
							aria-label="Next image"
							onClick={() => {
								navigateExpandedImage(1);
							}}
						>
							<ChevronRightIcon className="size-5" />
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
