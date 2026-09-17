import type { Id } from "@/convex/_generated/dataModel";
import { projectContextFromChat } from "../client-project-context";

describe("projectContextFromChat", () => {
  it("restores id and validated purpose from a persisted chat", () => {
    const id = "project_alpha" as Id<"projects">;
    expect(projectContextFromChat({ project_id: id, purpose: "app" })).toEqual({
      id,
      type: "app",
    });
  });

  it("clears context for legacy chats and safely coerces invalid purpose", () => {
    expect(projectContextFromChat({ purpose: "app" })).toBeNull();
    const id = "project_alpha" as Id<"projects">;
    expect(
      projectContextFromChat({ project_id: id, purpose: "spoof" }),
    ).toEqual({ id, type: "security" });
  });
});
