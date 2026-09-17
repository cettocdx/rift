/** Small local tool catalog shared by the terminal and metered model gateway. */
export const LOCAL_TOOL_SCHEMAS = {
  ask_question: {
    description:
      "Ask the operator a concise clarification only when their answer is needed. Provide 2–6 short options. The operator may write a custom answer; never treat a default selection as approval.",
    properties: {
      title: { type: "string", maxLength: 2000 },
      options: {
        type: "array",
        minItems: 2,
        maxItems: 6,
        items: { type: "string", maxLength: 500 },
      },
    },
    required: ["title", "options"],
  },
  read_file: {
    description:
      "Read a UTF-8 text file within the current project. Use offset and limit for large files.",
    properties: {
      path: { type: "string" },
      offset: { type: "integer", minimum: 1 },
      limit: { type: "integer", minimum: 1, maximum: 2000 },
    },
    required: ["path"],
  },
  list_files: {
    description:
      "List a project directory, including file and directory names.",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  write_file: {
    description:
      "Create or replace a UTF-8 file in the project. Read existing files before replacing them.",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  edit_file: {
    description:
      "Replace one exact unique occurrence in an existing project file. Fails if the text is missing or ambiguous.",
    properties: {
      path: { type: "string" },
      old_text: { type: "string" },
      new_text: { type: "string" },
    },
    required: ["path", "old_text", "new_text"],
  },
  run_command: {
    description:
      "Run a shell command from the project directory. Use for searching, building, tests and git. Output is bounded. Commands require operator approval unless Run freely is selected.",
    properties: {
      command: { type: "string" },
      timeout_ms: { type: "integer", minimum: 1000, maximum: 120000 },
    },
    required: ["command"],
  },
} as const;
export const localToolNeedsApproval = (mode: string, name: string) =>
  mode !== "full" &&
  !["read_file", "list_files", "ask_question"].includes(name) &&
  !(mode === "auto" && ["write_file", "edit_file"].includes(name));
