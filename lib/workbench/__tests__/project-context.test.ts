import {
  createWorkbenchRequestHeaders,
  STANDALONE_WORKBENCH_REQUEST_HEADERS,
  WORKBENCH_CHAT_ID_HEADER,
  WORKBENCH_PROJECT_ID_HEADER,
} from "../project-context";

describe("Workbench browser project context", () => {
  it("preserves the standalone request contract when no project is selected", () => {
    expect(createWorkbenchRequestHeaders()).toEqual(
      STANDALONE_WORKBENCH_REQUEST_HEADERS,
    );
    expect(createWorkbenchRequestHeaders()).toEqual({
      "X-RIFT-Workbench": "1",
    });
  });

  it("carries a durable chat binding without inventing a project id", () => {
    expect(createWorkbenchRequestHeaders({ chatId: "chat-123" })).toEqual({
      "X-RIFT-Workbench": "1",
      [WORKBENCH_CHAT_ID_HEADER]: "chat-123",
    });
  });

  it("carries the optimistic project only for a fresh chat", () => {
    expect(createWorkbenchRequestHeaders({ projectId: "project-123" })).toEqual(
      {
        "X-RIFT-Workbench": "1",
        [WORKBENCH_PROJECT_ID_HEADER]: "project-123",
      },
    );
  });
});
