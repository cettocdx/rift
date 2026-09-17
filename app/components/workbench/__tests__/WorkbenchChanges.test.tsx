import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorkbenchChanges } from "../WorkbenchChanges";
import { useWorkbench, WorkbenchProvider } from "../WorkbenchProvider";
import type {
  WorkbenchAdapter,
  WorkbenchGitFileStatus,
  WorkbenchGitSnapshot,
} from "../types";

const modifiedFile = {
  name: "README.md",
  status: "modified" as const,
  indexStatus: " ",
  workingTreeStatus: "M",
  staged: false,
};

const stagedFile = {
  ...modifiedFile,
  indexStatus: "M",
  workingTreeStatus: " ",
  staged: true,
};

const TWO_HUNK_DIFF = `--- a/README.md
+++ b/README.md
@@ -1,3 +1,4 @@
 intro
+added line
 body
@@ -20,4 +21,3 @@ body
 tail
-removed line
 end
`;

function snapshot(
  files: WorkbenchGitFileStatus[],
  repositoryPath = "project",
): WorkbenchGitSnapshot {
  const stagedCount = files.filter((file) => file.staged).length;
  return {
    repositoryPath,
    truncated: false,
    status: {
      currentBranch: "main",
      ahead: 0,
      behind: 0,
      detached: false,
      fileStatus: files,
      isClean: files.length === 0,
      hasChanges: files.length > 0,
      hasStaged: stagedCount > 0,
      hasUntracked: false,
      hasConflicts: false,
      totalCount: files.length,
      stagedCount,
      unstagedCount: files.filter((file) => file.workingTreeStatus !== " ")
        .length,
      untrackedCount: 0,
      conflictCount: 0,
    },
  };
}

function createAdapter() {
  return {
    listDirectory: jest.fn<WorkbenchAdapter["listDirectory"]>(),
    readFile: jest.fn<WorkbenchAdapter["readFile"]>(),
    writeFile: jest.fn<WorkbenchAdapter["writeFile"]>(),
    readGit: jest.fn<WorkbenchAdapter["readGit"]>(),
    readGitDiff: jest.fn<WorkbenchAdapter["readGitDiff"]>(),
    mutateGit: jest.fn<WorkbenchAdapter["mutateGit"]>(),
  } satisfies WorkbenchAdapter;
}

function renderChanges(adapter: WorkbenchAdapter) {
  return render(
    <WorkbenchProvider adapter={adapter}>
      <WorkbenchChanges />
    </WorkbenchProvider>,
  );
}

function RepositorySwitchHarness() {
  const [actionError, setActionError] = useState("");
  const {
    state: { git },
    actions: { refreshGit, stageGitFile },
  } = useWorkbench();
  return (
    <>
      <button type="button" onClick={() => void refreshGit("repo-b")}>
        Switch repository
      </button>
      <button
        type="button"
        onClick={() =>
          void stageGitFile("README.md").catch((error: unknown) =>
            setActionError(error instanceof Error ? error.message : "failed"),
          )
        }
      >
        Stage through provider
      </button>
      <output aria-label="Current repository">{git.repositoryPath}</output>
      <output aria-label="Provider action error">{actionError}</output>
      <WorkbenchChanges />
    </>
  );
}

describe("WorkbenchChanges", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("selects a file, reads its unified diff, and stages it", async () => {
    const adapter = createAdapter();
    adapter.readGit
      .mockResolvedValueOnce(snapshot([modifiedFile]))
      .mockResolvedValueOnce(snapshot([stagedFile]));
    adapter.readGitDiff.mockResolvedValue({
      repositoryPath: "project",
      diff: {
        path: "README.md",
        staged: { content: "", truncated: false },
        unstaged: {
          content: "@@ -1 +1 @@\n-old\n+new\n",
          truncated: false,
        },
      },
    });
    adapter.mutateGit.mockResolvedValue({ ok: true, action: "stage" });

    renderChanges(adapter);
    fireEvent.click(await screen.findByRole("button", { name: /README\.md/ }));

    expect(
      await screen.findByLabelText("Working tree unified diff for README.md"),
    ).toHaveTextContent("+new");
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));

    await waitFor(() => {
      expect(adapter.mutateGit).toHaveBeenCalledWith({
        action: "stage",
        path: "project",
        file: "README.md",
        renamedFrom: undefined,
      });
      expect(adapter.readGit).toHaveBeenCalledTimes(2);
    });
  });

  it("commits staged changes and reports the local commit id", async () => {
    const adapter = createAdapter();
    adapter.readGit
      .mockResolvedValueOnce(snapshot([stagedFile]))
      .mockResolvedValueOnce(snapshot([]));
    adapter.readGitDiff.mockResolvedValue({
      repositoryPath: "project",
      diff: {
        path: "README.md",
        staged: { content: "+ready\n", truncated: false },
        unstaged: { content: "", truncated: false },
      },
    });
    adapter.mutateGit.mockResolvedValue({
      ok: true,
      action: "commit",
      commit: { oid: "a".repeat(40) },
    });

    renderChanges(adapter);
    const input = await screen.findByLabelText("Commit Staged Changes");
    fireEvent.change(input, { target: { value: "Document Git flow" } });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));

    await waitFor(() => {
      expect(adapter.mutateGit).toHaveBeenCalledWith({
        action: "commit",
        path: "project",
        message: "Document Git flow",
      });
      expect(screen.getAllByText("Committed aaaaaaaa")).toHaveLength(2);
    });
    expect(input).toHaveValue("");
  });

  it("disables commit when the bounded change list is incomplete", async () => {
    const adapter = createAdapter();
    const truncatedSnapshot = snapshot([stagedFile]);
    truncatedSnapshot.truncated = true;
    adapter.readGit.mockResolvedValue(truncatedSnapshot);

    renderChanges(adapter);
    const input = await screen.findByLabelText("Commit Staged Changes");
    fireEvent.change(input, { target: { value: "Unsafe partial commit" } });

    expect(screen.getByRole("button", { name: "Commit" })).toBeDisabled();
    expect(
      screen.getByText(/commits are disabled while the list is incomplete/i),
    ).toBeInTheDocument();
    expect(adapter.mutateGit).not.toHaveBeenCalled();
  });

  it("does not announce an incomplete empty result as a clean tree", async () => {
    const adapter = createAdapter();
    const incomplete = snapshot([]);
    incomplete.truncated = true;
    if (incomplete.status) {
      incomplete.status.isClean = false;
      incomplete.status.hasChanges = true;
    }
    adapter.readGit.mockResolvedValue(incomplete);

    renderChanges(adapter);

    expect(
      await screen.findByText(/repository state is incomplete/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Working tree is clean."),
    ).not.toBeInTheDocument();
  });

  it("refreshes the same repository after a failed staging attempt", async () => {
    const adapter = createAdapter();
    adapter.readGit
      .mockResolvedValueOnce(snapshot([modifiedFile]))
      .mockResolvedValueOnce(snapshot([modifiedFile]));
    adapter.readGitDiff.mockResolvedValue({
      repositoryPath: "project",
      diff: {
        path: "README.md",
        staged: { content: "", truncated: false },
        unstaged: { content: "+changed\n", truncated: false },
      },
    });
    adapter.mutateGit.mockRejectedValue(new Error("Repository is busy"));

    renderChanges(adapter);
    fireEvent.click(await screen.findByRole("button", { name: /README\.md/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Stage" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Repository is busy",
    );
    expect(adapter.readGit).toHaveBeenNthCalledWith(2, "project");
  });

  it("preserves operation completion across a deferred same-repository refresh", async () => {
    const adapter = createAdapter();
    let finishRefresh!: (value: WorkbenchGitSnapshot) => void;
    const deferredRefresh = new Promise<WorkbenchGitSnapshot>((resolve) => {
      finishRefresh = resolve;
    });
    adapter.readGit
      .mockResolvedValueOnce(snapshot([modifiedFile]))
      .mockImplementationOnce(async () => deferredRefresh);
    adapter.readGitDiff.mockResolvedValue({
      repositoryPath: "project",
      diff: {
        path: "README.md",
        staged: { content: "", truncated: false },
        unstaged: { content: "+working\n", truncated: false },
      },
    });
    adapter.mutateGit.mockResolvedValue({ ok: true, action: "stage" });

    render(
      <WorkbenchProvider adapter={adapter}>
        <RepositorySwitchHarness />
      </WorkbenchProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /README\.md/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Stage" }));
    await waitFor(() => expect(adapter.readGit).toHaveBeenCalledTimes(2));

    expect(screen.getByLabelText("Current repository")).toHaveTextContent(
      "project",
    );
    finishRefresh(snapshot([stagedFile]));

    await waitFor(() =>
      expect(screen.getAllByText("Staged README.md")).toHaveLength(2),
    );
    expect(screen.getByLabelText("Current repository")).toHaveTextContent(
      "project",
    );
  });

  it("supports arrow-key navigation between working and staged diff tabs", async () => {
    const adapter = createAdapter();
    adapter.readGit.mockResolvedValue(
      snapshot([
        {
          ...stagedFile,
          workingTreeStatus: "M",
        },
      ]),
    );
    adapter.readGitDiff.mockResolvedValue({
      repositoryPath: "project",
      diff: {
        path: "README.md",
        staged: { content: "+staged\n", truncated: false },
        unstaged: { content: "+working\n", truncated: false },
      },
    });

    renderChanges(adapter);
    fireEvent.click(await screen.findByRole("button", { name: /README\.md/ }));
    await screen.findByLabelText("Working tree unified diff for README.md");
    const workingTab = screen.getByRole("tab", { name: "Working" });
    const stagedTab = screen.getByRole("tab", { name: "Staged" });
    workingTab.focus();
    fireEvent.keyDown(workingTab, { key: "ArrowRight" });

    expect(stagedTab).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(stagedTab).toHaveFocus());
  });

  it("does not let a completed mutation refresh replace a newer repository", async () => {
    const adapter = createAdapter();
    let finishMutation!: () => void;
    const mutation = new Promise<void>((resolve) => {
      finishMutation = resolve;
    });
    const repoBFile = { ...modifiedFile, name: "repo-b.txt" };
    adapter.readGit.mockImplementation(async (path) =>
      path === "repo-b"
        ? snapshot([repoBFile], "repo-b")
        : snapshot([modifiedFile], "project"),
    );
    adapter.readGitDiff.mockResolvedValue({
      repositoryPath: "project",
      diff: {
        path: "README.md",
        staged: { content: "", truncated: false },
        unstaged: { content: "+working\n", truncated: false },
      },
    });
    adapter.mutateGit.mockImplementation(async () => {
      await mutation;
      return { ok: true, action: "stage" };
    });

    render(
      <WorkbenchProvider adapter={adapter}>
        <RepositorySwitchHarness />
      </WorkbenchProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /README\.md/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Stage" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch repository" }));

    expect(
      await screen.findByLabelText("Current repository"),
    ).toHaveTextContent("repo-b");
    expect(
      await screen.findByRole("button", { name: /repo-b\.txt/ }),
    ).toBeInTheDocument();
    finishMutation();

    await waitFor(() => expect(adapter.mutateGit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(adapter.readGit).toHaveBeenCalledTimes(2));
    expect(adapter.readGit).toHaveBeenNthCalledWith(1, "");
    expect(adapter.readGit).toHaveBeenNthCalledWith(2, "repo-b");
    expect(screen.getByLabelText("Current repository")).toHaveTextContent(
      "repo-b",
    );
    expect(screen.queryByText("Staged README.md")).not.toBeInTheDocument();
  });

  it("invalidates stale mutation capability while a new repository loads or fails", async () => {
    const adapter = createAdapter();
    let rejectRepoB!: (reason: Error) => void;
    const repoB = new Promise<WorkbenchGitSnapshot>((_resolve, reject) => {
      rejectRepoB = reject;
    });
    adapter.readGit.mockImplementation(async (path) =>
      path === "repo-b" ? repoB : snapshot([modifiedFile], "project"),
    );

    render(
      <WorkbenchProvider adapter={adapter}>
        <RepositorySwitchHarness />
      </WorkbenchProvider>,
    );
    expect(
      await screen.findByRole("button", { name: /README\.md/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch repository" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Stage through provider" }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Provider action error")).toHaveTextContent(
        /open a file inside a git repository/i,
      ),
    );
    expect(adapter.mutateGit).not.toHaveBeenCalled();
    rejectRepoB(new Error("Repository B unavailable"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Repository B unavailable",
    );
    expect(screen.getByLabelText("Current repository")).toBeEmptyDOMElement();

    fireEvent.click(
      screen.getByRole("button", { name: "Stage through provider" }),
    );
    await waitFor(() => expect(adapter.mutateGit).not.toHaveBeenCalled());
  });

  it("does not render a late diff response from a previous repository", async () => {
    const adapter = createAdapter();
    let finishDiff!: (
      value: Awaited<ReturnType<WorkbenchAdapter["readGitDiff"]>>,
    ) => void;
    const deferredDiff = new Promise<
      Awaited<ReturnType<WorkbenchAdapter["readGitDiff"]>>
    >((resolve) => {
      finishDiff = resolve;
    });
    const repoBFile = { ...modifiedFile, name: "repo-b.txt" };
    adapter.readGit.mockImplementation(async (path) =>
      path === "repo-b"
        ? snapshot([repoBFile], "repo-b")
        : snapshot([modifiedFile], "project"),
    );
    adapter.readGitDiff.mockImplementation(async () => deferredDiff);

    render(
      <WorkbenchProvider adapter={adapter}>
        <RepositorySwitchHarness />
      </WorkbenchProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /README\.md/ }));
    await waitFor(() => expect(adapter.readGitDiff).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Switch repository" }));
    expect(
      await screen.findByRole("button", { name: /repo-b\.txt/ }),
    ).toBeInTheDocument();

    finishDiff({
      repositoryPath: "project",
      diff: {
        path: "README.md",
        staged: { content: "", truncated: false },
        unstaged: { content: "+stale repository diff\n", truncated: false },
      },
    });

    await waitFor(() =>
      expect(
        screen.queryByText(/stale repository diff/),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Current repository")).toHaveTextContent(
      "repo-b",
    );
  });

  it("offers per-hunk controls and stages only the chosen hunk", async () => {
    // Reviewing an agent's edit was all-or-nothing per file. Most reviews are
    // not: "these lines are right, that one is not" is the normal case.
    const adapter = createAdapter();
    adapter.readGit.mockResolvedValue(snapshot([modifiedFile]));
    adapter.readGitDiff.mockResolvedValue({
      repositoryPath: "project",
      diff: {
        path: "README.md",
        staged: { content: "", truncated: false },
        unstaged: { content: TWO_HUNK_DIFF, truncated: false },
      },
    });
    adapter.mutateGit.mockResolvedValue({ ok: true, action: "apply_hunk" });

    renderChanges(adapter);
    fireEvent.click(await screen.findByRole("button", { name: /README\.md/ }));

    const stageButtons = await screen.findAllByRole("button", {
      name: /^Stage hunk/,
    });
    expect(stageButtons).toHaveLength(2);

    fireEvent.click(stageButtons[1]);

    await waitFor(() => expect(adapter.mutateGit).toHaveBeenCalled());
    const call = adapter.mutateGit.mock.calls.find(
      ([mutation]) => (mutation as { action: string }).action === "apply_hunk",
    );
    expect(call).toBeDefined();
    const mutation = call![0] as {
      mode: string;
      patch: string;
      file: string;
    };
    expect(mutation.mode).toBe("accept");
    expect(mutation.file).toBe("README.md");
    // Exactly the hunk that was clicked, and only that one.
    expect(mutation.patch.match(/^@@/gm)).toHaveLength(1);
    expect(mutation.patch).toContain("-removed line");
    expect(mutation.patch).not.toContain("+added line");
  });

  it("reverts a single hunk without touching the rest of the file", async () => {
    const adapter = createAdapter();
    adapter.readGit.mockResolvedValue(snapshot([modifiedFile]));
    adapter.readGitDiff.mockResolvedValue({
      repositoryPath: "project",
      diff: {
        path: "README.md",
        staged: { content: "", truncated: false },
        unstaged: { content: TWO_HUNK_DIFF, truncated: false },
      },
    });
    adapter.mutateGit.mockResolvedValue({ ok: true, action: "apply_hunk" });

    renderChanges(adapter);
    fireEvent.click(await screen.findByRole("button", { name: /README\.md/ }));

    const revertButtons = await screen.findAllByRole("button", {
      name: /^Revert hunk/,
    });
    fireEvent.click(revertButtons[0]);

    await waitFor(() => expect(adapter.mutateGit).toHaveBeenCalled());
    const mutation = adapter.mutateGit.mock.calls.find(
      ([m]) => (m as { action: string }).action === "apply_hunk",
    )![0] as { mode: string; patch: string };
    expect(mutation.mode).toBe("reject");
    expect(mutation.patch).toContain("+added line");
  });

  it("offers no hunk controls on a truncated patch", async () => {
    // A truncated patch is not the whole hunk, so a patch built from it would
    // apply something other than what the reader is looking at.
    const adapter = createAdapter();
    adapter.readGit.mockResolvedValue(snapshot([modifiedFile]));
    adapter.readGitDiff.mockResolvedValue({
      repositoryPath: "project",
      diff: {
        path: "README.md",
        staged: { content: "", truncated: false },
        unstaged: { content: TWO_HUNK_DIFF, truncated: true },
      },
    });

    renderChanges(adapter);
    fireEvent.click(await screen.findByRole("button", { name: /README\.md/ }));
    await screen.findByText(/Patch truncated/);

    expect(
      screen.queryByRole("button", { name: /^Stage hunk/ }),
    ).not.toBeInTheDocument();
  });

  it("offers a way forward when there is no repository, not just a message", async () => {
    // The empty state used to report the absence and stop there, leaving the
    // panel useless in exactly the situation a new project starts in.
    const adapter = createAdapter();
    adapter.readGit.mockResolvedValue({
      repositoryPath: null,
      truncated: false,
      status: null,
    } as never);

    renderChanges(adapter);

    expect(
      await screen.findByRole("button", { name: "Initialize Git" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open another folder" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue without Git" }),
    ).toBeInTheDocument();
    // Cloning needs a remote and credentials; a control that cannot finish is
    // the class of dead button this redesign removes.
    expect(
      screen.queryByRole("button", { name: /Clone/ }),
    ).not.toBeInTheDocument();
  });

  it("lets a user dismiss Git and get back to it", async () => {
    const adapter = createAdapter();
    adapter.readGit.mockResolvedValue({
      repositoryPath: null,
      truncated: false,
      status: null,
    } as never);

    renderChanges(adapter);
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue without Git" }),
    );

    expect(screen.getByText(/Changes are not tracked here/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set up Git" }));
    expect(
      screen.getByRole("button", { name: "Initialize Git" }),
    ).toBeInTheDocument();
  });

  it("reports why initialization failed instead of silently doing nothing", async () => {
    const adapter = createAdapter();
    adapter.readGit.mockResolvedValue({
      repositoryPath: null,
      truncated: false,
      status: null,
    } as never);
    adapter.mutateGit.mockRejectedValue(
      new Error("This location is already a Git repository."),
    );

    renderChanges(adapter);
    // A file must be open, so RIFT knows where to create the repository.
    fireEvent.click(
      await screen.findByRole("button", { name: "Open another folder" }),
    );

    const initButton = await screen.findByRole("button", {
      name: "Initialize Git",
    });
    expect(initButton).toBeDisabled();
  });
});
