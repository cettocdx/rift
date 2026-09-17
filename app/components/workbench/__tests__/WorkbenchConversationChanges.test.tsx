import "@testing-library/jest-dom";
import { describe, expect, it, jest } from "@jest/globals";
import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { WorkbenchConversationChanges } from "../WorkbenchConversationChanges";
import { toast } from "sonner";
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));
import type { FileDiffStat } from "../../agent-activity";

jest.mock("../../DiffView", () => ({
  DiffView: function MockDiff(props: {
    originalContent: string;
    modifiedContent: string;
  }) {
    return (
      <div data-testid="inline-diff">
        {props.originalContent} → {props.modifiedContent}
      </div>
    );
  },
}));

function changed(path: string, added = 3, removed = 1): FileDiffStat {
  return {
    path,
    added,
    removed,
    execution: {
      path,
      content: "after",
      action: "editing",
      originalContent: "before",
    },
  };
}

describe("WorkbenchConversationChanges", () => {
  it("opens the actual latest execution for each file, retaining full accessible paths", async () => {
    const onOpen = jest.fn();
    const file = changed("backend/app/analytics/indicators.py");
    render(<WorkbenchConversationChanges changes={[file]} onOpen={onOpen} />);
    const row = screen.getByRole("button", { name: `Review ${file.path}` });
    expect(row).toHaveAttribute("title", file.path);
    expect(within(row).getByText("indicators.py")).toBeVisible();
    fireEvent.click(row);
    await screen.findByTestId("inline-diff");
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(onOpen).not.toHaveBeenCalled();
    expect(
      screen.getByRole("region", { name: `Diff ${file.path}` }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: `Open ${file.path} in editor` }),
    );
    expect(onOpen).toHaveBeenCalledWith(file.execution);
    expect(screen.getByLabelText("3 additions, 1 deletions")).toBeVisible();
  });

  it("does not present unknown diffs as zero or include their numbers in totals", () => {
    const unknown = {
      ...changed("unknown.ts", 900, 800),
      diffUnavailable: true,
    };
    render(
      <WorkbenchConversationChanges
        changes={[changed("known.ts"), unknown]}
        onOpen={jest.fn()}
      />,
    );
    expect(
      screen.getByLabelText("3 additions, 1 deletions, known diffs only"),
    ).toBeVisible();
    expect(screen.getByText(/1 file has no available diff/)).toBeVisible();
    const row = screen.getByRole("button", { name: "Review unknown.ts" });
    expect(within(row).getByText("Diff unavailable")).toBeVisible();
    expect(within(row).queryByText("+900")).not.toBeInTheDocument();
    expect(screen.queryByText("+903")).not.toBeInTheDocument();
  });

  it("shows an honest empty state without manufactured branch or pull request controls", () => {
    render(<WorkbenchConversationChanges changes={[]} onOpen={jest.fn()} />);
    expect(screen.getByText("No changes yet")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/additions/)).not.toBeInTheDocument();
  });

  it("updates the counts and opens new execution data when a streamed edit replaces a file", async () => {
    const onOpen = jest.fn();
    const file = changed("README.md");
    const { rerender } = render(
      <WorkbenchConversationChanges changes={[file]} onOpen={onOpen} />,
    );
    const latest = changed("README.md", 8, 2);
    rerender(
      <WorkbenchConversationChanges changes={[latest]} onOpen={onOpen} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review README.md" }));
    await screen.findByTestId("inline-diff");
    fireEvent.click(
      screen.getByRole("button", { name: "Open README.md in editor" }),
    );
    expect(onOpen).toHaveBeenCalledWith(latest.execution);
    expect(screen.getByLabelText("8 additions, 2 deletions")).toBeVisible();
  });
  it("expands one diff in place and preserves expansion through streamed updates", async () => {
    const files = [changed("one.ts"), changed("two.ts")];
    const { rerender } = render(
      <WorkbenchConversationChanges changes={files} onOpen={jest.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review one.ts" }));
    expect(await screen.findByTestId("inline-diff")).toHaveTextContent(
      "before → after",
    );
    fireEvent.click(screen.getByRole("button", { name: "Review two.ts" }));
    expect(
      screen.queryByRole("region", { name: "Diff one.ts" }),
    ).not.toBeInTheDocument();
    const updated = changed("two.ts");
    updated.execution = {
      path: "two.ts",
      action: "editing",
      content: "new output",
      originalContent: "after",
    };
    rerender(
      <WorkbenchConversationChanges
        changes={[files[0], updated]}
        onOpen={jest.fn()}
      />,
    );
    expect(screen.getByTestId("inline-diff")).toHaveTextContent(
      "after → new output",
    );
    fireEvent.click(screen.getByRole("button", { name: "Review two.ts" }));
    expect(screen.queryByTestId("inline-diff")).not.toBeInTheDocument();
  });
});

it("copies the complete path without opening or expanding the file", async () => {
  const writeText = jest
    .fn<(value: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const file = changed("/workspace/a long directory/file.ts");
  const onOpen = jest.fn();
  render(<WorkbenchConversationChanges changes={[file]} onOpen={onOpen} />);
  fireEvent.click(
    screen.getByRole("button", { name: `Copy path ${file.path}` }),
  );
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(file.path));
  expect(
    screen.getByRole("button", { name: `Review ${file.path}` }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(onOpen).not.toHaveBeenCalled();
});
it("reports clipboard rejection without claiming success", async () => {
  const success = jest
    .spyOn(toast, "success")
    .mockImplementation(() => "success");
  const failure = jest.spyOn(toast, "error").mockImplementation(() => "error");
  const writeText = jest
    .fn<(value: string) => Promise<void>>()
    .mockRejectedValue(new Error("denied"));
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(
    <WorkbenchConversationChanges
      changes={[changed("one.ts")]}
      onOpen={jest.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy path one.ts" }));
  await waitFor(() => expect(failure).toHaveBeenCalled());
  expect(success).not.toHaveBeenCalled();
  success.mockRestore();
  failure.mockRestore();
});
