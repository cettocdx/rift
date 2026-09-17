import { useEffect } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useWorkbench, WorkbenchProvider } from "../WorkbenchProvider";
import type { WorkbenchAdapter } from "../types";

function DirectoryLoadProbe() {
  const { actions } = useWorkbench();

  useEffect(() => {
    void actions.loadDirectory("");
    void actions.loadDirectory("");
  }, [actions]);

  return null;
}

function FileLoadProbe() {
  const { actions } = useWorkbench();

  useEffect(() => {
    void actions.reloadDocument("/app/page.tsx");
    void actions.reloadDocument("/app/page.tsx");
  }, [actions]);

  return null;
}

describe("WorkbenchProvider directory loading", () => {
  it("coalesces concurrent requests for the same directory", async () => {
    const listDirectory = jest
      .fn<WorkbenchAdapter["listDirectory"]>()
      .mockResolvedValue({ path: "", entries: [], truncated: false });
    const adapter: WorkbenchAdapter = {
      listDirectory,
      readFile: jest.fn<WorkbenchAdapter["readFile"]>(),
      writeFile: jest.fn<WorkbenchAdapter["writeFile"]>(),
      readGit: jest.fn<WorkbenchAdapter["readGit"]>(),
      readGitDiff: jest.fn<WorkbenchAdapter["readGitDiff"]>(),
      mutateGit: jest.fn<WorkbenchAdapter["mutateGit"]>(),
    };

    render(
      <WorkbenchProvider adapter={adapter}>
        <DirectoryLoadProbe />
      </WorkbenchProvider>,
    );

    await waitFor(() => expect(listDirectory).toHaveBeenCalledTimes(1));
  });

  it("coalesces concurrent reads for the same file", async () => {
    const readFile = jest.fn<WorkbenchAdapter["readFile"]>().mockResolvedValue({
      path: "/app/page.tsx",
      content: "export default function Page() {}",
      revision: "rev-1",
      size: 33,
      modifiedAt: null,
    });
    const adapter: WorkbenchAdapter = {
      listDirectory: jest.fn<WorkbenchAdapter["listDirectory"]>(),
      readFile,
      writeFile: jest.fn<WorkbenchAdapter["writeFile"]>(),
      readGit: jest.fn<WorkbenchAdapter["readGit"]>(),
      readGitDiff: jest.fn<WorkbenchAdapter["readGitDiff"]>(),
      mutateGit: jest.fn<WorkbenchAdapter["mutateGit"]>(),
    };

    render(
      <WorkbenchProvider adapter={adapter}>
        <FileLoadProbe />
      </WorkbenchProvider>,
    );

    await waitFor(() => expect(readFile).toHaveBeenCalledTimes(1));
  });
});

function RefreshProbe() {
  const { state, actions } = useWorkbench();
  return (
    <>
      <button
        onClick={async () => {
          await actions.loadDirectory("");
          await actions.loadDirectory("src");
        }}
      >
        Load tree
      </button>
      <button onClick={() => actions.loadDirectory("", true)}>
        Refresh tree
      </button>
      <output>
        {state.directories.src?.entries.map((entry) => entry.name).join(",")}
      </output>
    </>
  );
}

it("refreshes previously loaded nested directories with the root", async () => {
  let version = "before.ts";
  const listDirectory = jest
    .fn<WorkbenchAdapter["listDirectory"]>()
    .mockImplementation(async (path) => ({
      path,
      entries:
        path === ""
          ? [{ name: "src", path: "src", type: "directory" }]
          : [{ name: version, path: `src/${version}`, type: "file" }],
      truncated: false,
    }));
  const adapter = { listDirectory } as unknown as WorkbenchAdapter;
  render(
    <WorkbenchProvider adapter={adapter}>
      <RefreshProbe />
    </WorkbenchProvider>,
  );
  fireEvent.click(screen.getByText("Load tree"));
  await screen.findByText("before.ts");
  version = "after.ts";
  fireEvent.click(screen.getByText("Refresh tree"));
  await screen.findByText("after.ts");
  expect(listDirectory.mock.calls.map(([path]) => path)).toEqual([
    "",
    "src",
    "",
    "src",
  ]);
});

it("allows a second root refresh while a child refresh is slow", async () => {
  let release!: () => void;
  const slow = new Promise<void>((resolve) => {
    release = resolve;
  });
  let childReads = 0;
  const listDirectory = jest
    .fn<WorkbenchAdapter["listDirectory"]>()
    .mockImplementation(async (path) => {
      if (path === "src" && ++childReads === 2) await slow;
      return {
        path,
        entries: [
          {
            name: "before.ts",
            path: "src/before.ts",
            type: "file",
            size: 0,
            modifiedAt: null,
          },
        ],
        truncated: false,
      };
    });
  render(
    <WorkbenchProvider
      adapter={{ listDirectory } as unknown as WorkbenchAdapter}
    >
      <RefreshProbe />
    </WorkbenchProvider>,
  );
  fireEvent.click(screen.getByText("Load tree"));
  await screen.findByText("before.ts");
  fireEvent.click(screen.getByText("Refresh tree"));
  await waitFor(() => expect(childReads).toBe(2));
  fireEvent.click(screen.getByText("Refresh tree"));
  await waitFor(() =>
    expect(
      listDirectory.mock.calls.filter(([path]) => path === ""),
    ).toHaveLength(3),
  );
  await act(async () => {
    release();
    await slow;
  });
});
