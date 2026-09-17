import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => jest.fn(),
  useAction: () => jest.fn(),
}));

const { ApiKeysTab } =
  jest.requireActual<typeof import("../ApiKeysTab")>("../ApiKeysTab");

describe("ApiKeysTab accessibility", () => {
  it("names the key field and announces unresolved key data", () => {
    render(<ApiKeysTab subscription="pro" />);

    expect(
      screen.getByRole("textbox", { name: "API key name" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading API keys");
  });
});
