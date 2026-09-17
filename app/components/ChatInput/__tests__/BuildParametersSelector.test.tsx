import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { BuildModelSelector } from "../BuildModelSelector";
import {
  getEffectiveBuildModel,
  type SelectedModel,
  type ReasoningEffort,
} from "@/types/chat";

function Harness() {
  const [model, setModel] = useState<SelectedModel>("build-codex");
  const [effort, setEffort] = useState<ReasoningEffort>("medium");
  return (
    <BuildModelSelector
      value={model}
      onChange={setModel}
      reasoningEffort={effort}
      onReasoningChange={setEffort}
    />
  );
}

test("one trigger exposes actual parameters, then changes model and supported effort within one portal", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  const trigger = screen.getByRole("button", {
    name: /Build model: GPT-5.6 Sol, effort: Medium/,
  });
  await user.click(trigger);
  expect(screen.getByText("Context")).toBeVisible();
  expect(screen.getByText("1.05M context")).toBeVisible();
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Model: GPT-5.6 Sol/ }));
  await user.click(screen.getByRole("radio", { name: /Qwen3.8 Max/ }));
  expect(
    screen.getByRole("button", { name: /Model: Qwen3.8 Max/ }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: /Effort: On/ }));
  const slider = screen.getByRole("slider", { name: "Reasoning effort" });
  await waitFor(() => expect(slider).toHaveFocus());
  expect(slider).toHaveAttribute(
    "max",
    String(
      getEffectiveBuildModel("build-qwen").reasoning.supportedEfforts.length -
        1,
    ),
  );
  fireEvent.keyDown(slider, { key: "Home" });
  expect(slider).toHaveAttribute("aria-valuetext", "Off");
  expect(
    document.querySelectorAll('[data-slot="popover-content"]'),
  ).toHaveLength(1);
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Effort: Off/ })).toHaveFocus(),
  );
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveAccessibleName("Build model: Qwen3.8 Max, effort: Off");
});

test("back, reopen and outside dismissal keep selections without a second popup", async () => {
  const user = userEvent.setup();
  render(
    <>
      <Harness />
      <button>Outside</button>
    </>,
  );
  const trigger = screen.getByRole("button", { name: /Build model:/ });
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: /Effort: Medium/ }));
  fireEvent.keyDown(screen.getByRole("slider"), { key: "End" });
  await user.click(
    screen.getByRole("button", { name: "Back to model parameters" }),
  );
  expect(screen.getByRole("button", { name: /Effort: Max/ })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Outside" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(trigger);
  expect(screen.getByRole("button", { name: /Effort: Max/ })).toBeVisible();
});

test("keyboard model choices use real contracts, and reset applies the selected model default", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: /Build model:/ }));
  await user.click(screen.getByRole("button", { name: /^Model:/ }));
  const selected = screen.getByRole("radio", { checked: true });
  await waitFor(() => expect(selected).toHaveFocus());
  await user.keyboard("{End}");
  const last = screen.getAllByRole("radio").at(-1)!;
  expect(last).toHaveFocus();
  expect(last).toHaveAttribute("aria-checked", "true");
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: /^Effort:/ }));
  const slider = screen.getByRole("slider");
  fireEvent.keyDown(slider, { key: "Home" });
  expect(slider).toHaveAttribute("aria-valuetext", "Off");
  await user.click(
    screen.getByRole("button", { name: "Reset reasoning effort" }),
  );
  expect(slider).toHaveAttribute("aria-valuetext", "On");
});

test("composer intents directly open or switch the one model and effort surface", async () => {
  const { unmount } = render(<Harness />);
  const trigger = screen.getByRole("button", { name: /Build model:/ });
  const open = (detail: string) => {
    const event = new CustomEvent("rift:composer-parameter-open", {
      detail,
      cancelable: true,
    });
    fireEvent(trigger, event);
    return event;
  };
  expect(open("invalid").defaultPrevented).toBe(false);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(open("model").defaultPrevented).toBe(true);
  await waitFor(() =>
    expect(screen.getByRole("radio", { checked: true })).toHaveFocus(),
  );
  act(() => {
    trigger.focus({ preventScroll: true });
    expect(open("model").defaultPrevented).toBe(true);
  });
  await waitFor(() =>
    expect(screen.getByRole("radio", { checked: true })).toHaveFocus(),
  );
  expect(open("effort").defaultPrevented).toBe(true);
  await waitFor(() =>
    expect(
      screen.getByRole("slider", { name: "Reasoning effort" }),
    ).toHaveFocus(),
  );
  expect(
    document.querySelectorAll('[data-slot="popover-content"]'),
  ).toHaveLength(1);
  expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  expect(open("model").defaultPrevented).toBe(true);
  await waitFor(() =>
    expect(screen.getByRole("radio", { checked: true })).toHaveFocus(),
  );
  unmount();
  expect(open("effort").defaultPrevented).toBe(false);
});

test("phone model panel keeps reasoning alongside model selection", async () => {
  const previous = window.innerWidth;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 390,
  });
  try {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /Build model:/ }));
    expect(screen.queryByText("Context")).not.toBeInTheDocument();
    expect(
      screen.getByRole("slider", { name: "Reasoning effort" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: /Model: GPT-5.6 Sol/ }),
    );
    await user.click(screen.getByRole("radio", { name: /Qwen3.8 Max/ }));
    expect(
      screen.getByRole("slider", { name: "Reasoning effort" }),
    ).toHaveAttribute("aria-valuetext", "On");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  } finally {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: previous,
    });
  }
});
