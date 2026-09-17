import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ReasoningEffortSelector } from "../ReasoningEffortSelector";
import { getEffectiveBuildModel, type ReasoningEffort } from "@/types/chat";

const model = getEffectiveBuildModel("build-codex");
const efforts = model.reasoning.supportedEfforts;

function Harness({ onChange = jest.fn() }: { onChange?: jest.Mock }) {
  const [value, setValue] = useState<ReasoningEffort>("medium");
  return (
    <ReasoningEffortSelector
      model="build-codex"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

function openSlider() {
  fireEvent.click(screen.getByRole("button", { name: /Reasoning strength/ }));
  const slider = screen.getByRole("slider", { name: "Reasoning effort" });
  // jsdom has no layout/pointer capture. Preserve real pointer coordinates.
  Object.defineProperty(slider, "setPointerCapture", {
    value: jest.fn(),
    configurable: true,
  });
  Object.defineProperty(slider, "releasePointerCapture", {
    value: jest.fn(),
    configurable: true,
  });
  const track = slider.previousElementSibling!;
  jest
    .spyOn(track, "getBoundingClientRect")
    .mockReturnValue({ left: 100, width: 200 } as DOMRect);
  return slider;
}

function pointer(slider: HTMLElement, type: string, x: number, pointerId = 1) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    button: 0,
  });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  fireEvent(slider, event);
}

describe("ReasoningEffortSelector", () => {
  it("opens without changing effort and focuses the accessible slider", () => {
    const onChange = jest.fn();
    render(
      <ReasoningEffortSelector
        model="build-codex"
        value="medium"
        onChange={onChange}
      />,
    );
    const slider = openSlider();
    expect(onChange).not.toHaveBeenCalled();
    expect(slider).toHaveFocus();
    expect(slider).toHaveAttribute("aria-valuetext", "Medium");
    expect(screen.queryByText(model.model)).not.toBeInTheDocument();
    fireEvent.change(slider, { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith(efforts[2]);
  });

  it("follows intermediate pointer positions, then commits one supported effort on release", () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    const slider = openSlider();
    pointer(slider, "pointerdown", 100);
    pointer(slider, "pointermove", 226);
    expect(
      document.querySelector('[data-ui="reasoning-effort-thumb"]'),
    ).toHaveStyle({ transform: "translateX(63%)" });
    expect(onChange).not.toHaveBeenCalled();
    pointer(slider, "pointerup", 226);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      efforts[Math.round(0.63 * (efforts.length - 1))],
    );
    expect(slider.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it("clamps captured drags outside the track and ignores a second pointer", () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    const slider = openSlider();
    pointer(slider, "pointerdown", 150);
    pointer(slider, "pointerdown", 100, 2);
    pointer(slider, "pointermove", 100, 2);
    pointer(slider, "pointercancel", 100, 2);
    expect(
      document.querySelector('[data-ui="reasoning-effort-thumb"]'),
    ).toHaveStyle({ transform: "translateX(25%)" });
    pointer(slider, "pointermove", 900);
    expect(
      document.querySelector('[data-ui="reasoning-effort-thumb"]'),
    ).toHaveStyle({ transform: "translateX(100%)" });
    pointer(slider, "pointerup", 900);
    expect(onChange).toHaveBeenCalledWith(efforts.at(-1));
    pointer(slider, "pointerdown", 100);
    pointer(slider, "pointerup", -100);
    expect(onChange).toHaveBeenLastCalledWith(efforts[0]);
  });

  it.each(["pointercancel", "lostpointercapture"])(
    "discards an uncommitted gesture on %s",
    (type) => {
      const onChange = jest.fn();
      render(<Harness onChange={onChange} />);
      const slider = openSlider();
      pointer(slider, "pointerdown", 300);
      pointer(slider, type, 300);
      pointer(slider, "pointerup", 300);
      expect(onChange).not.toHaveBeenCalled();
      expect(slider).toHaveAttribute("aria-valuetext", "Medium");
    },
  );

  it("supports keyboard endpoints and one-step adjustments without exceeding model capabilities", () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    const slider = openSlider();
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(efforts[0]);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(efforts[1]);
    fireEvent.keyDown(slider, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(efforts.at(-1));
    const calls = onChange.mock.calls.length;
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledTimes(calls);
  });

  it("reports open/close and cancels a draft when Escape closes the popover", () => {
    const onChange = jest.fn();
    const onOpenChange = jest.fn();
    render(
      <ReasoningEffortSelector
        model="build-codex"
        value="medium"
        onChange={onChange}
        onOpenChange={onOpenChange}
      />,
    );
    const slider = openSlider();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    pointer(slider, "pointerdown", 300);
    fireEvent.keyDown(slider, { key: "Escape" });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(openSlider()).toHaveAttribute("aria-valuetext", "Medium");
  });

  it("resets to the selected model's default", () => {
    const onChange = jest.fn();
    render(
      <ReasoningEffortSelector
        model="build-codex"
        value="max"
        onChange={onChange}
      />,
    );
    openSlider();
    fireEvent.click(
      screen.getByRole("button", { name: "Reset reasoning effort" }),
    );
    expect(onChange).toHaveBeenCalledWith(model.reasoning.defaultEffort);
  });
});
