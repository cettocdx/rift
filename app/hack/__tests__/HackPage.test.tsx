import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import HackPage from "../page";

const mockGetUserIDAndPro = jest.fn();

jest.mock("@/lib/auth/get-user-id", () => ({
  getUserIDAndPro: (...args: unknown[]) => mockGetUserIDAndPro(...args),
}));

jest.mock("@/app/components/HackerMode", () => ({
  HackerMode: ({
    chatId,
    durableEnabled,
  }: {
    chatId: string;
    durableEnabled?: boolean;
  }) => (
    <div data-testid="hack-workbench" data-durable={String(durableEnabled)}>
      {chatId}
    </div>
  ),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  redirect: (destination: string): never => {
    throw new Error(`REDIRECT:${destination}`);
  },
}));

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("HackPage Max gate", () => {
  beforeEach(() => {
    mockGetUserIDAndPro.mockReset();
  });

  it("renders the Max upgrade gate for a Pro account", async () => {
    mockGetUserIDAndPro.mockResolvedValue({
      userId: "pro-user",
      subscription: "pro",
    });

    render(
      await HackPage({
        searchParams: Promise.resolve({ session: SESSION_ID }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "RIFT Max required" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/exclusively with RIFT Max at \$129/i),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /upgrade to max/i }),
    ).toHaveAttribute("href", "/upgrade?feature=hack");
    expect(screen.queryByTestId("hack-workbench")).not.toBeInTheDocument();
  });

  it("renders Hack Workbench for a Max account", async () => {
    mockGetUserIDAndPro.mockResolvedValue({
      userId: "max-user",
      subscription: "ultra",
    });

    render(
      await HackPage({
        searchParams: Promise.resolve({ session: SESSION_ID }),
      }),
    );

    expect(screen.getByTestId("hack-workbench")).toHaveTextContent(SESSION_ID);
    expect(
      screen.queryByRole("heading", { name: "RIFT Max required" }),
    ).not.toBeInTheDocument();
  });
});

it.each([
  ["true", "true", "true"],
  ["true", "false", "false"],
  ["false", "true", "false"],
])(
  "requires both server rollout flags (%s, %s)",
  async (hackFlag, dispatchFlag, expected) => {
    const oldHack = process.env.RIFT_DURABLE_HACK_ENABLED;
    const oldDispatch = process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
    process.env.RIFT_DURABLE_HACK_ENABLED = hackFlag;
    process.env.RIFT_DURABLE_DISPATCH_ADMISSION = dispatchFlag;
    try {
      mockGetUserIDAndPro.mockResolvedValue({
        userId: "max-user",
        subscription: "ultra",
      });
      render(
        await HackPage({
          searchParams: Promise.resolve({ session: SESSION_ID }),
        }),
      );
      expect(screen.getByTestId("hack-workbench")).toHaveAttribute(
        "data-durable",
        expected,
      );
    } finally {
      if (oldHack === undefined) delete process.env.RIFT_DURABLE_HACK_ENABLED;
      else process.env.RIFT_DURABLE_HACK_ENABLED = oldHack;
      if (oldDispatch === undefined)
        delete process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
      else process.env.RIFT_DURABLE_DISPATCH_ADMISSION = oldDispatch;
    }
  },
);
