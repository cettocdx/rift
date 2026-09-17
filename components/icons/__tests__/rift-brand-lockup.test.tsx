import { render, screen } from "@testing-library/react";
import { RiftBrandLockup } from "../rift-brand-lockup";

describe("RiftBrandLockup", () => {
  it("preserves supplied horizontal proportions and outlined letters", () => {
    render(
      <RiftBrandLockup
        markSize={27}
        textSize={15}
        gap={10}
        className="brand-lockup"
        markClassName="brand-mark"
        textClassName="brand-text"
      />,
    );
    const lockup = screen.getByRole("img", { name: "RIFT" });
    expect(lockup).toHaveClass("brand-lockup");
    expect(lockup).toHaveAttribute("viewBox", "0 0 428 152");
    expect(
      Number(lockup.getAttribute("width")) /
        Number(lockup.getAttribute("height")),
    ).toBeCloseTo(428 / 152);
    expect(lockup.querySelector(".brand-mark")).toHaveAttribute(
      "transform",
      "translate(16 17) scale(1.2)",
    );
    expect(
      lockup.querySelector(".brand-text")?.querySelectorAll("path"),
    ).toHaveLength(4);
    expect(lockup.querySelector("text")).toBeNull();
  });
  it("is decorative inside an already labelled control", () => {
    render(
      <button aria-label="RIFT home">
        <RiftBrandLockup decorative />
      </button>,
    );
    expect(screen.getByRole("button", { name: "RIFT home" })).toBeVisible();
    expect(screen.queryByRole("img")).toBeNull();
  });
  it("supports a surface-specific accessible label", () => {
    render(<RiftBrandLockup label="RIFT workspace" />);
    expect(screen.getByRole("img", { name: "RIFT workspace" })).toBeVisible();
  });
});
