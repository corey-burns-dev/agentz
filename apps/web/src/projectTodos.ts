import type { ProjectReadFileResult } from "@agents/contracts";

export const PROJECT_TODO_FILE_CANDIDATES = ["TODO.md", "todo.md", "TODOS.md", "todos.md"] as const;

export interface ProjectTodoItem {
  readonly completed: boolean;
  readonly id: string;
  readonly lineIndex: number;
  readonly text: string;
}

export function selectProjectTodoFile(
  files: ReadonlyArray<ProjectReadFileResult>,
): ProjectReadFileResult {
  return (
    files.find((file) => file.exists) ?? {
      relativePath: PROJECT_TODO_FILE_CANDIDATES[0],
      exists: false,
      contents: null,
    }
  );
}

export function parseProjectTodoItems(contents: string | null): ProjectTodoItem[] {
  if (!contents) {
    return [];
  }

  return contents.split(/\r?\n/).flatMap((line, lineIndex) => {
    const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*?)\s*$/);
    if (!match) {
      return [];
    }
    const text = match[2]?.trim();
    if (!text) {
      return [];
    }
    return [
      {
        completed: match[1]?.toLowerCase() === "x",
        id: `${lineIndex}:${text}`,
        lineIndex,
        text,
      },
    ];
  });
}

export function appendProjectTodoItem(existingContents: string | null, todoText: string): string {
  const trimmedTodoText = todoText.trim();
  if (trimmedTodoText.length === 0) {
    return existingContents ?? "";
  }

  if (!existingContents || existingContents.trim().length === 0) {
    return `# TODO\n\n- [ ] ${trimmedTodoText}\n`;
  }

  const needsTrailingNewline = !existingContents.endsWith("\n");
  const prefix = needsTrailingNewline ? `${existingContents}\n` : existingContents;
  return `${prefix}- [ ] ${trimmedTodoText}\n`;
}

export function toggleProjectTodoCompletion(
  existingContents: string | null,
  lineIndex: number,
): string {
  if (!existingContents) {
    return existingContents ?? "";
  }

  const lines = existingContents.split(/\r?\n/);
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return existingContents;
  }

  const line = lines[lineIndex] ?? "";
  const match = line.match(/^(\s*[-*]\s+\[)([ xX])(\]\s+.*)$/);
  if (!match) {
    return existingContents;
  }

  const prefix = match[1] ?? "";
  const current = match[2] ?? " ";
  const suffix = match[3] ?? "";
  const next = current.toLowerCase() === "x" ? " " : "x";

  lines[lineIndex] = `${prefix}${next}${suffix}`;
  return lines.join("\n");
}
