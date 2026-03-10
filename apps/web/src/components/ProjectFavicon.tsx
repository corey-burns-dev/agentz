import { FolderIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { buildProjectFaviconUrl } from "~/projectFavicon";
import { useProjectFaviconOverride } from "~/projectFaviconSettings";
import { type ProjectFaviconDisplaySize, useUISettings } from "~/uiSettings";

const FAVICON_SIZE_CLASS_NAMES: Record<ProjectFaviconDisplaySize, string> = {
  small: "size-3",
  medium: "size-3.5",
  large: "size-4.5",
};

function ProjectFaviconImage({
  cwd,
  sizeClassName,
  overridePath,
  overrideSetAt,
}: {
  cwd: string;
  sizeClassName: string;
  overridePath: string | null;
  overrideSetAt: number;
}) {
  const sources = useMemo(() => {
    if (overridePath) {
      return [
        buildProjectFaviconUrl({
          cwd,
          relativePath: overridePath,
          cacheBust: overrideSetAt,
        }),
        buildProjectFaviconUrl({ cwd }),
      ];
    }
    return [buildProjectFaviconUrl({ cwd })];
  }, [cwd, overridePath, overrideSetAt]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");

  if (status === "error") {
    return <FolderIcon className={`${sizeClassName} shrink-0 text-muted-foreground/50`} />;
  }

  return (
    <span className={`${sizeClassName} relative shrink-0`}>
      <FolderIcon
        className={`absolute inset-0 ${sizeClassName} text-muted-foreground/50 transition-opacity ${
          status === "loaded" ? "opacity-0" : "opacity-100"
        }`}
      />
      <img
        key={sources[sourceIndex]}
        src={sources[sourceIndex]}
        alt=""
        className={`${sizeClassName} rounded-sm object-contain transition-opacity ${
          status === "loaded" ? "opacity-100" : "opacity-0"
        }`}
        onLoad={() => setStatus("loaded")}
        onError={() => {
          setSourceIndex((currentSourceIndex) => {
            if (currentSourceIndex + 1 < sources.length) {
              setStatus("loading");
              return currentSourceIndex + 1;
            }
            setStatus("error");
            return currentSourceIndex;
          });
        }}
      />
    </span>
  );
}

export function ProjectFavicon({
  cwd,
  displaySize,
  relativePathOverride,
}: {
  cwd: string;
  displaySize?: ProjectFaviconDisplaySize;
  relativePathOverride?: string | null;
}) {
  const { settings } = useUISettings();
  const { relativePath: storedOverride, setAt: storedSetAt } = useProjectFaviconOverride(cwd);
  const effectiveOverride = relativePathOverride ?? storedOverride ?? null;
  const effectiveSize = displaySize ?? settings.projectFaviconSize;
  const sizeClassName = FAVICON_SIZE_CLASS_NAMES[effectiveSize];

  return (
    <ProjectFaviconImage
      key={`${cwd}:${effectiveOverride ?? "__auto__"}:${storedSetAt}`}
      cwd={cwd}
      sizeClassName={sizeClassName}
      overridePath={effectiveOverride}
      overrideSetAt={storedSetAt}
    />
  );
}
