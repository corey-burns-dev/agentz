import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";
import {
	PROJECT_TODO_FILE_CANDIDATES,
	selectProjectTodoFile,
} from "~/projectTodos";

export const projectTodoQueryKeys = {
	file: (cwd: string | null) => ["projects", "todo-file", cwd] as const,
};

const PROJECT_TODO_STALE_TIME_MS = 15_000;

export function projectTodoFileQueryOptions(input: {
	cwd: string | null;
	enabled?: boolean;
}) {
	return queryOptions({
		queryKey: projectTodoQueryKeys.file(input.cwd),
		queryFn: async () => {
			const api = ensureNativeApi();
			if (!input.cwd) {
				throw new Error("Project todos are unavailable.");
			}

			const files = await Promise.all(
				PROJECT_TODO_FILE_CANDIDATES.map((relativePath) =>
					api.projects.readFile({
						cwd: input.cwd!,
						relativePath,
					}),
				),
			);

			return selectProjectTodoFile(files);
		},
		enabled: (input.enabled ?? true) && input.cwd !== null,
		staleTime: PROJECT_TODO_STALE_TIME_MS,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
	});
}
