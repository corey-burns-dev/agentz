import { describe, expect, it } from "vitest";

import {
  appendProjectTodoItem,
  parseProjectTodoItems,
  selectProjectTodoFile,
  toggleProjectTodoCompletion,
} from "./projectTodos";

describe("projectTodos", () => {
  it("prefers the first existing todo file candidate", () => {
    const selected = selectProjectTodoFile([
      { relativePath: "TODO.md", exists: false, contents: null },
      { relativePath: "todos.md", exists: true, contents: "- [ ] Ship it\n" },
    ]);

    expect(selected).toEqual({
      relativePath: "todos.md",
      exists: true,
      contents: "- [ ] Ship it\n",
    });
  });

  it("falls back to TODO.md when no todo file exists", () => {
    const selected = selectProjectTodoFile([]);

    expect(selected).toEqual({
      relativePath: "TODO.md",
      exists: false,
      contents: null,
    });
  });

  it("parses markdown task list items into todo entries", () => {
    expect(
      parseProjectTodoItems(
        "# TODO\n\n- [ ] Add project todo panel\n- [x] Remove issues warning\n",
      ),
    ).toEqual([
      {
        completed: false,
        id: "2:Add project todo panel",
        lineIndex: 2,
        text: "Add project todo panel",
      },
      {
        completed: true,
        id: "3:Remove issues warning",
        lineIndex: 3,
        text: "Remove issues warning",
      },
    ]);
  });

  it("creates a new todo file scaffold when adding the first item", () => {
    expect(appendProjectTodoItem(null, "Ship the todo UI")).toBe(
      "# TODO\n\n- [ ] Ship the todo UI\n",
    );
  });

  it("appends a todo item to an existing file", () => {
    expect(appendProjectTodoItem("# TODO\n\n- [x] Done already\n", "Next item")).toBe(
      "# TODO\n\n- [x] Done already\n- [ ] Next item\n",
    );
  });

  it("toggles todo completion in-place", () => {
    const contents = "# TODO\n\n- [ ] Add project todo panel\n- [x] Remove issues warning\n";

    expect(toggleProjectTodoCompletion(contents, 2)).toBe(
      "# TODO\n\n- [x] Add project todo panel\n- [x] Remove issues warning\n",
    );

    expect(toggleProjectTodoCompletion(contents, 3)).toBe(
      "# TODO\n\n- [ ] Add project todo panel\n- [ ] Remove issues warning\n",
    );
  });
});
