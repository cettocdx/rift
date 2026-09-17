import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, jest } from "@jest/globals";

const { ModelSelector } = jest.requireActual<
  typeof import("../../ModelSelector")
>("../../ModelSelector");

describe("ModelSelector (single-model)", () => {
  it("renders nothing (single-model, no toolbar badge)", () => {
    const { container } = render(
      <ModelSelector value="auto" onChange={jest.fn()} mode="agent" />,
    );

    // Single-model product: no model badge in the chat toolbar.
    expect(container.firstChild).toBeNull();
    expect(
      screen.queryByText(/Recon|Strike|Dominate|RIFT/),
    ).not.toBeInTheDocument();
  });
});
