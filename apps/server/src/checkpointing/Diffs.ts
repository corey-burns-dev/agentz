import { parsePatchFiles } from "@pierre/diffs";

export interface TurnDiffFileSummary {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

interface ParsedHunk {
  readonly additionLines: number;
  readonly deletionLines: number;
}
interface ParsedFile {
  readonly name: string;
  readonly hunks: ReadonlyArray<ParsedHunk>;
}
interface ParsedPatch {
  readonly files: ReadonlyArray<ParsedFile>;
}

export function parseTurnDiffFilesFromUnifiedDiff(
  diff: string,
): ReadonlyArray<TurnDiffFileSummary> {
  const normalized = diff.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return [];
  }

  const parsedPatches = parsePatchFiles(normalized) as ReadonlyArray<ParsedPatch>;
  const files = parsedPatches.flatMap((patch) =>
    patch.files.map((file) => ({
      path: file.name,
      additions: file.hunks.reduce(
        (total: number, hunk: ParsedHunk) => total + hunk.additionLines,
        0,
      ),
      deletions: file.hunks.reduce(
        (total: number, hunk: ParsedHunk) => total + hunk.deletionLines,
        0,
      ),
    })),
  );

  return files.toSorted((left: TurnDiffFileSummary, right: TurnDiffFileSummary) =>
    left.path.localeCompare(right.path),
  );
}
