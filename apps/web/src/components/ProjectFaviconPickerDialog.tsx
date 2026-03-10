import { compareProjectFaviconPaths, isProjectImageFilePath } from "@agents/shared/projectFavicon";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircleIcon, SearchIcon } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { projectSearchEntriesQueryOptions } from "~/lib/projectReactQuery";
import { setProjectFaviconOverrideForKey } from "~/projectFaviconSettings";
import type { Project } from "~/types";
import { ProjectFavicon } from "./ProjectFavicon";

export function ProjectFaviconPickerDialog({
  project,
  open,
  onOpenChange,
  onClearOverride,
}: {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClearOverride: () => void;
}) {
  const [query, setQuery] = useState("favicon");
  const deferredQuery = useDeferredValue(query.trim());
  const effectiveQuery = deferredQuery.length > 0 ? deferredQuery : "favicon";

  useEffect(() => {
    if (!open) return;
    setQuery("favicon");
  }, [open]);

  const { data, isFetching, isLoading } = useQuery(
    projectSearchEntriesQueryOptions({
      cwd: project?.cwd ?? null,
      query: effectiveQuery,
      enabled: open && project !== null,
      limit: 200,
    }),
  );

  const candidates = useMemo(() => {
    return (data?.entries ?? [])
      .filter((entry) => entry.kind === "file" && isProjectImageFilePath(entry.path))
      .toSorted((left, right) => compareProjectFaviconPaths(left.path, right.path));
  }, [data?.entries]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose project favicon</DialogTitle>
          <DialogDescription>
            Search this repo for an icon file. Try <code>favicon</code>, <code>icon</code>,{" "}
            <code>logo</code>, or a path fragment.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="space-y-2">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search favicon, icon, logo, or path"
                className="ps-8"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Selecting a file stores a local override for this project on this device.
            </p>
          </div>

          <div className="max-h-96 space-y-2 overflow-y-auto">
            {isLoading || isFetching ? (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-background/50 px-3 py-4 text-sm text-muted-foreground">
                <LoaderCircleIcon className="size-4 animate-spin" />
                Searching {project?.name ?? "project"}…
              </div>
            ) : candidates.length > 0 ? (
              candidates.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-background/50 px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/30"
                  onClick={() => {
                    if (!project) return;
                    setProjectFaviconOverrideForKey(project.cwd, entry.path);
                    onOpenChange(false);
                  }}
                >
                  <ProjectFavicon
                    cwd={project?.cwd ?? ""}
                    relativePathOverride={entry.path}
                    displaySize="large"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {entry.path.split("/").at(-1)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {entry.path}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-background/50 px-3 py-5 text-sm text-muted-foreground">
                No image files matched <code>{effectiveQuery}</code>.
              </div>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClearOverride}>
            Use auto-detected favicon
          </Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
