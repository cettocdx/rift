import "@testing-library/jest-dom";
import { renderHook } from "@testing-library/react";
import { useAuth } from "../useAuth";

let mockAuthState = { isLoading: false, isAuthenticated: false };
let mockViewer: unknown = undefined;
let mockEntitlements: unknown = undefined;

jest.mock("convex/react", () => ({
  useConvexAuth: () => mockAuthState,
  useQuery: (query: string) =>
    query === "users.viewer" ? mockViewer : mockEntitlements,
}));

jest.mock("@/convex/_generated/api", () => ({
  api: {
    users: { viewer: "users.viewer" },
    subscriptions: {
      getMyEntitlements: "subscriptions.getMyEntitlements",
    },
  },
}));

describe("useAuth entitlement readiness", () => {
  afterEach(() => {
    mockAuthState = { isLoading: false, isAuthenticated: false };
    mockViewer = undefined;
    mockEntitlements = undefined;
  });

  it("keeps entitlement readiness false while authentication is loading", () => {
    mockAuthState = { isLoading: true, isAuthenticated: false };

    const { result } = renderHook(() => useAuth());

    expect(result.current.entitlements).toEqual([]);
    expect(result.current.entitlementsReady).toBe(false);
  });

  it("distinguishes an unresolved entitlement query from a resolved free tier", () => {
    mockAuthState = { isLoading: false, isAuthenticated: true };
    mockViewer = {
      _id: "user_1",
      email: "operator@example.com",
      name: "RIFT Operator",
      image: null,
    };

    const { result, rerender } = renderHook(() => useAuth());

    expect(result.current.loading).toBe(false);
    expect(result.current.entitlements).toEqual([]);
    expect(result.current.entitlementsReady).toBe(false);

    mockEntitlements = [];
    rerender();

    expect(result.current.entitlements).toEqual([]);
    expect(result.current.entitlementsReady).toBe(true);
  });

  it("publishes paid entitlements only after the query resolves", () => {
    mockAuthState = { isLoading: false, isAuthenticated: true };
    mockViewer = {
      _id: "user_2",
      email: "pro@example.com",
      name: "Pro Operator",
      image: null,
    };
    mockEntitlements = ["pro-plan"];

    const { result } = renderHook(() => useAuth());

    expect(result.current.entitlementsReady).toBe(true);
    expect(result.current.entitlements).toEqual(["pro-plan"]);
  });
});
