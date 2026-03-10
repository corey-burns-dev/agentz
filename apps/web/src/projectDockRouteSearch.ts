export type ProjectDockTab = "git" | "files";

export interface ProjectDockRouteSearch {
  projectDock?: "1";
  projectDockTab?: ProjectDockTab;
}

function isProjectDockOpenValue(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

function normalizeProjectDockTab(value: unknown): ProjectDockTab | undefined {
  return value === "files" || value === "git" ? value : undefined;
}

export function stripProjectDockSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "projectDock" | "projectDockTab"> {
  const { projectDock: _projectDock, projectDockTab: _projectDockTab, ...rest } = params;
  return rest as Omit<T, "projectDock" | "projectDockTab">;
}

export function parseProjectDockRouteSearch(
  search: Record<string, unknown>,
): ProjectDockRouteSearch {
  const projectDock = isProjectDockOpenValue(search.projectDock) ? "1" : undefined;
  const projectDockTab = projectDock
    ? (normalizeProjectDockTab(search.projectDockTab) ?? "git")
    : undefined;

  return {
    ...(projectDock ? { projectDock } : {}),
    ...(projectDockTab ? { projectDockTab } : {}),
  };
}
