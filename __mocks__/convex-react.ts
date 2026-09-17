// Create stable mock references for hooks
const mockMutation = jest.fn();
const mockAction = jest.fn();

export const useMutation = () => mockMutation;

// Convex Auth: injectable viewer + auth state, defaulting to unauthenticated.
// Tests can override via the __set* helpers below and reset with __resetAuth().
let viewerValue: unknown = undefined;
let authState: { isLoading: boolean; isAuthenticated: boolean } = {
  isLoading: false,
  isAuthenticated: false,
};

export const __setViewer = (value: unknown) => {
  viewerValue = value;
};
export const __setAuthState = (state: {
  isLoading: boolean;
  isAuthenticated: boolean;
}) => {
  authState = state;
};
export const __resetAuth = () => {
  viewerValue = undefined;
  authState = { isLoading: false, isAuthenticated: false };
};

export const useQuery = () => viewerValue;

// Dynamic query groups start unresolved unless a focused test supplies data.
const pendingQueries: Record<string, undefined> = {};
export const useQueries = () => pendingQueries;

export const useAction = () => mockAction;

export const useConvexAuth = () => authState;

// Create stable reference for paginated query results
const stablePaginatedResult = {
  results: [],
  status: "Exhausted" as const,
  loadMore: jest.fn(),
  isLoading: false,
};

export const usePaginatedQuery = () => stablePaginatedResult;

// Create stable convex client mock
const convexClientMock = {
  query: jest.fn(),
  mutation: jest.fn(),
  action: jest.fn(),
};

export const useConvex = () => convexClientMock;
