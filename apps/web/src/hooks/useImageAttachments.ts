import type { MessageId } from "@agents/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	collectUserMessageBlobPreviewUrls,
	revokeBlobPreviewUrl,
	revokeUserMessagePreviewUrls,
} from "../lib/imageUtils";
import type { ChatMessage } from "../types";

/** How long (ms) to keep handed-off blob preview URLs alive after a message is confirmed. */
const ATTACHMENT_PREVIEW_HANDOFF_TTL_MS = 5000;

export interface UseImageAttachmentsResult {
	/** Map from messageId → blob preview URLs being kept alive during server-side confirmation. */
	attachmentPreviewHandoffByMessageId: Record<string, string[]>;
	/** Clears all handed-off preview URLs and revokes their blob memory. */
	clearAttachmentPreviewHandoffs: () => void;
	/**
	 * Hands off blob preview URLs from an optimistic message to its server-confirmed
	 * counterpart, keeping them alive for ATTACHMENT_PREVIEW_HANDOFF_TTL_MS.
	 */
	handoffAttachmentPreviews: (
		messageId: MessageId,
		previewUrls: string[],
	) => void;
}

/**
 * Manages blob: preview URL lifecycle for image attachments.
 *
 * Optimistic user messages have blob: preview URLs that must be:
 * - Kept alive during the server-confirmation window (handed off to the confirmed message).
 * - Revoked when no longer needed to free browser memory.
 */
export function useImageAttachments(params: {
	/** Ref to the current list of optimistic messages — used for cleanup on unmount. */
	optimisticUserMessagesRef: React.MutableRefObject<ChatMessage[]>;
}): UseImageAttachmentsResult {
	const { optimisticUserMessagesRef } = params;

	const [
		attachmentPreviewHandoffByMessageId,
		setAttachmentPreviewHandoffByMessageId,
	] = useState<Record<string, string[]>>({});

	const attachmentPreviewHandoffByMessageIdRef = useRef<
		Record<string, string[]>
	>({});
	const attachmentPreviewHandoffTimeoutByMessageIdRef = useRef<
		Record<string, number>
	>({});

	// Keep the ref in sync with state so callbacks can read the latest map without
	// declaring it in their dependency arrays.
	useEffect(() => {
		attachmentPreviewHandoffByMessageIdRef.current =
			attachmentPreviewHandoffByMessageId;
	}, [attachmentPreviewHandoffByMessageId]);

	const clearAttachmentPreviewHandoffs = useCallback(() => {
		for (const timeoutId of Object.values(
			attachmentPreviewHandoffTimeoutByMessageIdRef.current,
		)) {
			window.clearTimeout(timeoutId);
		}
		attachmentPreviewHandoffTimeoutByMessageIdRef.current = {};
		for (const previewUrls of Object.values(
			attachmentPreviewHandoffByMessageIdRef.current,
		)) {
			for (const previewUrl of previewUrls) {
				revokeBlobPreviewUrl(previewUrl);
			}
		}
		attachmentPreviewHandoffByMessageIdRef.current = {};
		setAttachmentPreviewHandoffByMessageId({});
	}, []);

	// Revoke all blob URLs on unmount.
	useEffect(() => {
		return () => {
			clearAttachmentPreviewHandoffs();
			for (const message of optimisticUserMessagesRef.current) {
				revokeUserMessagePreviewUrls(message);
			}
		};
	}, [clearAttachmentPreviewHandoffs, optimisticUserMessagesRef]);

	const handoffAttachmentPreviews = useCallback(
		(messageId: MessageId, previewUrls: string[]) => {
			if (previewUrls.length === 0) return;

			const previousPreviewUrls =
				attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
			for (const previewUrl of previousPreviewUrls) {
				if (!previewUrls.includes(previewUrl)) {
					revokeBlobPreviewUrl(previewUrl);
				}
			}
			setAttachmentPreviewHandoffByMessageId((existing) => {
				const next = {
					...existing,
					[messageId]: previewUrls,
				};
				attachmentPreviewHandoffByMessageIdRef.current = next;
				return next;
			});

			const existingTimeout =
				attachmentPreviewHandoffTimeoutByMessageIdRef.current[messageId];
			if (typeof existingTimeout === "number") {
				window.clearTimeout(existingTimeout);
			}
			attachmentPreviewHandoffTimeoutByMessageIdRef.current[messageId] =
				window.setTimeout(() => {
					const currentPreviewUrls =
						attachmentPreviewHandoffByMessageIdRef.current[messageId];
					if (currentPreviewUrls) {
						for (const previewUrl of currentPreviewUrls) {
							revokeBlobPreviewUrl(previewUrl);
						}
					}
					setAttachmentPreviewHandoffByMessageId((existing) => {
						if (!(messageId in existing)) return existing;
						const next = { ...existing };
						delete next[messageId];
						attachmentPreviewHandoffByMessageIdRef.current = next;
						return next;
					});
					delete attachmentPreviewHandoffTimeoutByMessageIdRef.current[
						messageId
					];
				}, ATTACHMENT_PREVIEW_HANDOFF_TTL_MS);
		},
		[],
	);

	return {
		attachmentPreviewHandoffByMessageId,
		clearAttachmentPreviewHandoffs,
		handoffAttachmentPreviews,
	};
}

export { collectUserMessageBlobPreviewUrls, revokeUserMessagePreviewUrls };
