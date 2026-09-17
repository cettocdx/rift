import {
  parseGitMutationCommand,
  GIT_MUTATION_COMMAND,
  GIT_INIT_COMMAND,
} from "../git-operations";

/**
 * The sandbox emits JSON; the server parses it against a schema. When those two
 * drift, a working operation is reported to the user as a malformed response --
 * which is exactly what happened when apply_hunk was added to the command but
 * not to the schema.
 *
 * These pin every action and failure code the command can actually emit.
 */

/** Every `result(...)` call site's action and code, read from the command. */
function emittedFailureCodes(command: string): string[] {
  return [...command.matchAll(/result\(False,[^,)]+,"([a-z_]+)"/g)].map(
    (match) => match[1],
  );
}

describe("the sandbox's replies parse", () => {
  it("accepts a success for every action the command implements", () => {
    for (const action of ["stage", "unstage", "commit", "apply_hunk"]) {
      expect(() =>
        parseGitMutationCommand(JSON.stringify({ ok: true, action })),
      ).not.toThrow();
    }
    expect(() =>
      parseGitMutationCommand(JSON.stringify({ ok: true, action: "init" })),
    ).not.toThrow();
  });

  it("accepts every failure code the mutation command can emit", () => {
    const codes = emittedFailureCodes(GIT_MUTATION_COMMAND);
    expect(codes.length).toBeGreaterThan(0);

    for (const code of new Set(codes)) {
      expect(() =>
        parseGitMutationCommand(
          JSON.stringify({ ok: false, action: "apply_hunk", code }),
        ),
      ).not.toThrow();
    }
  });

  it("accepts every failure code the init command can emit", () => {
    for (const code of new Set(emittedFailureCodes(GIT_INIT_COMMAND))) {
      expect(() =>
        parseGitMutationCommand(
          JSON.stringify({ ok: false, action: "init", code }),
        ),
      ).not.toThrow();
    }
  });

  it("still refuses an action the command does not implement", () => {
    // The schema is a boundary, not a rubber stamp.
    expect(() =>
      parseGitMutationCommand(
        JSON.stringify({ ok: true, action: "push" }),
      ),
    ).toThrow();
  });

  it("still refuses an unknown failure code", () => {
    expect(() =>
      parseGitMutationCommand(
        JSON.stringify({ ok: false, action: "stage", code: "made_up" }),
      ),
    ).toThrow();
  });
});
