import type { ThreadId } from "@agents/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { readNativeApi } from "../nativeApi";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { MAX_THREAD_TERMINAL_COUNT } from "../types";

export interface TerminalManagementResult {
  terminalFocusRequestId: number;
  requestTerminalFocus: () => void;
  setTerminalOpen: (open: boolean) => void;
  setTerminalHeight: (height: number) => void;
  toggleTerminalVisibility: () => void;
  splitTerminal: () => void;
  createNewTerminal: () => void;
  activateTerminal: (terminalId: string) => void;
  closeTerminal: (terminalId: string) => void;
}

/**
 * Manages terminal lifecycle for a thread: open/close, split, focus tracking,
 * and keyboard-to-composer focus restoration.
 */
export function useTerminalManagement(params: {
  threadId: ThreadId;
  focusComposer: () => void;
}): TerminalManagementResult {
  const { threadId, focusComposer } = params;

  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadId, threadId),
  );
  const storeSetTerminalOpen = useTerminalStateStore((s) => s.setTerminalOpen);
  const storeSetTerminalHeight = useTerminalStateStore((s) => s.setTerminalHeight);
  const storeSplitTerminal = useTerminalStateStore((s) => s.splitTerminal);
  const storeNewTerminal = useTerminalStateStore((s) => s.newTerminal);
  const storeSetActiveTerminal = useTerminalStateStore((s) => s.setActiveTerminal);
  const storeCloseTerminal = useTerminalStateStore((s) => s.closeTerminal);

  const [terminalFocusRequestId, setTerminalFocusRequestId] = useState(0);
  const terminalOpenByThreadRef = useRef<Record<string, boolean>>({});

  const requestTerminalFocus = useCallback(() => {
    setTerminalFocusRequestId((value) => value + 1);
  }, []);

  const hasReachedTerminalLimit = terminalState.terminalIds.length >= MAX_THREAD_TERMINAL_COUNT;

  const setTerminalOpen = useCallback(
    (open: boolean) => {
      storeSetTerminalOpen(threadId, open);
    },
    [threadId, storeSetTerminalOpen],
  );

  const setTerminalHeight = useCallback(
    (height: number) => {
      storeSetTerminalHeight(threadId, height);
    },
    [threadId, storeSetTerminalHeight],
  );

  const toggleTerminalVisibility = useCallback(() => {
    storeSetTerminalOpen(threadId, !terminalState.terminalOpen);
  }, [threadId, storeSetTerminalOpen, terminalState.terminalOpen]);

  const splitTerminal = useCallback(() => {
    if (hasReachedTerminalLimit) return;
    const terminalId = `terminal-${crypto.randomUUID()}`;
    storeSplitTerminal(threadId, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  }, [threadId, storeSplitTerminal, hasReachedTerminalLimit]);

  const createNewTerminal = useCallback(() => {
    if (hasReachedTerminalLimit) return;
    const terminalId = `terminal-${crypto.randomUUID()}`;
    storeNewTerminal(threadId, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  }, [threadId, storeNewTerminal, hasReachedTerminalLimit]);

  const activateTerminal = useCallback(
    (terminalId: string) => {
      storeSetActiveTerminal(threadId, terminalId);
      setTerminalFocusRequestId((value) => value + 1);
    },
    [threadId, storeSetActiveTerminal],
  );

  const closeTerminal = useCallback(
    (terminalId: string) => {
      const api = readNativeApi();
      if (!api) return;
      const isFinalTerminal = terminalState.terminalIds.length <= 1;
      const fallbackExitWrite = () =>
        api.terminal.write({ threadId, terminalId, data: "exit\n" }).catch(() => undefined);
      if ("close" in api.terminal && typeof api.terminal.close === "function") {
        void (async () => {
          if (isFinalTerminal) {
            await api.terminal.clear({ threadId, terminalId }).catch(() => undefined);
          }
          await api.terminal.close({
            threadId,
            terminalId,
            deleteHistory: true,
          });
        })().catch(() => fallbackExitWrite());
      } else {
        void fallbackExitWrite();
      }
      storeCloseTerminal(threadId, terminalId);
      setTerminalFocusRequestId((value) => value + 1);
    },
    [threadId, storeCloseTerminal, terminalState.terminalIds.length],
  );

  // When the terminal opens, request focus. When it closes, return focus to composer.
  useEffect(() => {
    const previous = terminalOpenByThreadRef.current[threadId] ?? false;
    const current = Boolean(terminalState.terminalOpen);

    if (!previous && current) {
      terminalOpenByThreadRef.current[threadId] = current;
      setTerminalFocusRequestId((value) => value + 1);
      return;
    } else if (previous && !current) {
      terminalOpenByThreadRef.current[threadId] = current;
      const frame = window.requestAnimationFrame(() => {
        focusComposer();
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    terminalOpenByThreadRef.current[threadId] = current;
  }, [threadId, focusComposer, terminalState.terminalOpen]);

  return {
    terminalFocusRequestId,
    requestTerminalFocus,
    setTerminalOpen,
    setTerminalHeight,
    toggleTerminalVisibility,
    splitTerminal,
    createNewTerminal,
    activateTerminal,
    closeTerminal,
  };
}
