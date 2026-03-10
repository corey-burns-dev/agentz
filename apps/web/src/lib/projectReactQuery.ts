import type { ProjectReadFileResult, ProjectSearchEntriesResult } from "@agents/contracts";
import { mutationOptions, type QueryClient, queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const projectQueryKeys = {
  all: ["projects"] as const,
  searchEntries: (cwd: string | null, query: string, limit: number) =>
    ["projects", "search-entries", cwd, query, limit] as const,
  readFile: (cwd: string | null, relativePath: string) =>
    ["projects", "read-file", cwd, relativePath] as const,
};

const DEFAULT_SEARCH_ENTRIES_LIMIT = 80;
const DEFAULT_SEARCH_ENTRIES_STALE_TIME = 15_000;
const DEFAULT_READ_FILE_STALE_TIME = 15_000;
const EMPTY_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = {
  entries: [],
  truncated: false,
};
const EMPTY_READ_FILE_RESULT: ProjectReadFileResult = {
  relativePath: "",
  exists: false,
  contents: null,
};

export function projectSearchEntriesQueryOptions(input: {
  cwd: string | null;
  query: string;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
  allowEmptyQuery?: boolean;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_ENTRIES_LIMIT;
  return queryOptions({
    queryKey: projectQueryKeys.searchEntries(input.cwd, input.query, limit),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Workspace entry search is unavailable.");
      }
      return api.projects.searchEntries({
        cwd: input.cwd,
        query: input.query,
        limit,
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.cwd !== null &&
      ((input.allowEmptyQuery ?? false) || input.query.length > 0),
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_ENTRIES_RESULT,
  });
}

export function projectReadFileQueryOptions(input: {
  cwd: string | null;
  relativePath: string;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.readFile(input.cwd, input.relativePath),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Project file reads are unavailable.");
      }
      return api.projects.readFile({
        cwd: input.cwd,
        relativePath: input.relativePath,
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.relativePath.trim().length > 0,
    staleTime: input.staleTime ?? DEFAULT_READ_FILE_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_READ_FILE_RESULT,
  });
}

export function invalidateProjectQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
}

export function projectWriteFileMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: ["projects", "mutation", "write-file", input.cwd] as const,
    mutationFn: async ({ relativePath, contents }: { relativePath: string; contents: string }) => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Project file writes are unavailable.");
      }
      return api.projects.writeFile({
        cwd: input.cwd,
        relativePath,
        contents,
      });
    },
    onSettled: async () => {
      await invalidateProjectQueries(input.queryClient);
    },
  });
}
