/** @jest-environment node */
import {
  createGithubTokenLoader,
  loadUserGithubToken,
} from "../load-user-github-token";
const query = jest.fn();
const mutation = jest.fn();
const client = { query, mutation };
jest.mock("@/lib/db/convex-client", () => ({
  getConvexServiceKey: () => "service",
  getConvexClient: () => client,
}));
const now = 1_800_000_000_000;
const credentials = {
  token: "old",
  username: "alice",
  connectionId: "row1",
  credentialsVersion: 2,
  refreshToken: "refresh",
  expiresAt: now + 30_000,
  refreshExpiresAt: now + 100_000,
};
beforeEach(() => {
  jest.spyOn(Date, "now").mockReturnValue(now);
  query.mockReset();
  mutation.mockReset().mockResolvedValue({ success: true });
  process.env.GITHUB_OAUTH_CLIENT_ID = "client";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";
  global.fetch = jest.fn();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function successfulRefresh() {
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({
      access_token: "new",
      refresh_token: "rotated",
      expires_in: 3600,
      refresh_token_expires_in: 7200,
    }),
  });
}
it("keeps PAT connections usable without OAuth configuration", async () => {
  query.mockResolvedValue({ token: "pat" });
  expect(await loadUserGithubToken("alice")).toEqual({
    token: "pat",
    username: undefined,
  });
  expect(fetch).not.toHaveBeenCalled();
});
it("refreshes near expiry and stores rotation with a connection/version guard", async () => {
  query.mockResolvedValue(credentials);
  mutation.mockResolvedValue({ success: true });
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({
      access_token: "new",
      refresh_token: "rotated",
      expires_in: 3600,
      refresh_token_expires_in: 7200,
    }),
  });
  expect(await loadUserGithubToken("alice")).toEqual({
    token: "new",
    username: "alice",
  });
  expect(mutation).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      connectionId: "row1",
      credentialsVersion: 2,
      token: "new",
      refreshToken: "rotated",
      expiresAt: now + 3600000,
      refreshExpiresAt: now + 7200000,
    }),
  );
  const request = (fetch as jest.Mock).mock.calls[0][1];
  expect(request.body.get("grant_type")).toBe("refresh_token");
  expect(request.signal).toBeDefined();
});
it("does not return an uncommitted refresh after disconnect", async () => {
  query.mockResolvedValueOnce(credentials).mockResolvedValueOnce(null);
  mutation
    .mockResolvedValueOnce({ success: true })
    .mockResolvedValueOnce({ success: false });
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({
      access_token: "new",
      refresh_token: "rotated",
      expires_in: 3600,
      refresh_token_expires_in: 7200,
    }),
  });
  expect(await loadUserGithubToken("alice")).toBeNull();
});
it("never returns an expired token on refresh failure", async () => {
  query.mockResolvedValue({ ...credentials, expiresAt: now - 1 });
  (fetch as jest.Mock).mockRejectedValue(new Error("sensitive provider body"));
  expect(await loadUserGithubToken("alice")).toBeNull();
});
it("does not attempt an expired refresh token", async () => {
  query.mockResolvedValue({
    ...credentials,
    expiresAt: now - 1,
    refreshExpiresAt: now - 1,
  });
  expect(await loadUserGithubToken("alice")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it("coalesces simultaneous lookups into one refresh request", async () => {
  query.mockResolvedValue(credentials);
  mutation.mockResolvedValue({ success: true });
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({
      access_token: "new",
      refresh_token: "rotated",
      expires_in: 3600,
    }),
  });
  const result = await Promise.all([
    loadUserGithubToken("alice"),
    loadUserGithubToken("alice"),
  ]);
  expect(result.map((value) => value?.token)).toEqual(["new", "new"]);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("returns the reconnected credentials after a failed CAS", async () => {
  query
    .mockResolvedValueOnce(credentials)
    .mockResolvedValueOnce({ token: "new-pat", username: "bob" });
  mutation
    .mockResolvedValueOnce({ success: true })
    .mockResolvedValueOnce({ success: false });
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({ access_token: "stale-rotation", expires_in: 3600 }),
  });
  expect(await loadUserGithubToken("alice")).toEqual({
    token: "new-pat",
    username: "bob",
  });
});
it("rejects malformed refresh receipts and never logs provider exception bodies", async () => {
  const warning = jest.spyOn(console, "warn");
  query.mockResolvedValue({ ...credentials, expiresAt: now - 1 });
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({ access_token: "new", expires_in: "invalid" }),
  });
  expect(await loadUserGithubToken("alice")).toBeNull();
  expect(mutation.mock.calls.some(([, args]) => args.token === "new")).toBe(
    false,
  );
  (fetch as jest.Mock).mockRejectedValue(new Error("sensitive-body"));
  expect(await loadUserGithubToken("alice")).toBeNull();
  expect(warning).not.toHaveBeenCalled();
});
it("keeps a still-valid token on transient refresh failure", async () => {
  query.mockResolvedValue(credentials);
  (fetch as jest.Mock).mockResolvedValue({ ok: false, status: 503 });
  expect(await loadUserGithubToken("alice")).toEqual({
    token: "old",
    username: "alice",
  });
});

it.each(["network response lost", "refresh timed out"])(
  "never returns the prior pair when %s after a refresh may have rotated remotely",
  async (message) => {
    query.mockResolvedValue(credentials);
    (fetch as jest.Mock).mockRejectedValue(new Error(message));
    expect(await loadUserGithubToken("alice")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mutation.mock.calls.filter(([, args]) => args.token)).toHaveLength(
      0,
    );
    expect(mutation.mock.calls.at(-1)[1]).toMatchObject({
      connectionId: credentials.connectionId,
      credentialsVersion: credentials.credentialsVersion,
      leaseId: expect.any(String),
    });
  },
);

it("waits for another worker's persisted rotation without refreshing twice", async () => {
  query.mockResolvedValueOnce(credentials).mockResolvedValueOnce({
    ...credentials,
    token: "other-worker",
    credentialsVersion: 3,
    expiresAt: now + 3600000,
  });
  mutation.mockResolvedValue({ success: false });
  expect(await loadUserGithubToken("alice")).toEqual({
    token: "other-worker",
    username: "alice",
  });
  expect(fetch).not.toHaveBeenCalled();
});

it("retries a transient persistence failure with the same rotated pair and lease", async () => {
  query.mockResolvedValue(credentials);
  successfulRefresh();
  let persistenceCalls = 0;
  mutation.mockImplementation(async (_name, args) => {
    if (args.token && ++persistenceCalls === 1)
      throw new Error("temporary save failure");
    return { success: true };
  });

  expect(await loadUserGithubToken("alice")).toEqual({
    token: "new",
    username: "alice",
  });
  const saves = mutation.mock.calls.filter(([, args]) => args.token);
  expect(saves).toHaveLength(2);
  expect(saves[1][1]).toEqual(saves[0][1]);
  expect(saves[0][1]).toMatchObject({
    leaseId: expect.any(String),
    credentialsVersion: 2,
    token: "new",
    refreshToken: "rotated",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("fails closed after bounded save failures instead of returning the rotated-away version", async () => {
  query.mockResolvedValue(credentials);
  successfulRefresh();
  mutation.mockImplementation(async (_name, args) => {
    if (args.token) throw new Error("persistent save failure");
    return { success: true };
  });

  expect(await loadUserGithubToken("alice")).toBeNull();
  expect(mutation.mock.calls.filter(([, args]) => args.token)).toHaveLength(3);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(mutation.mock.calls.at(-1)[1]).toMatchObject({
    leaseId: expect.any(String),
    credentialsVersion: 2,
  });
  expect(mutation.mock.calls.at(-1)[1]).not.toHaveProperty("token");
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({ error: "bad_refresh_token" }),
  });
  expect(await loadUserGithubToken("alice")).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(mutation.mock.calls.filter(([, args]) => args.token)).toHaveLength(3);
});

it("uses the committed version after a lost persistence acknowledgement without saving twice", async () => {
  query.mockResolvedValueOnce(credentials).mockResolvedValue({
    ...credentials,
    token: "new",
    refreshToken: "rotated",
    credentialsVersion: 3,
    expiresAt: now + 3600000,
  });
  successfulRefresh();
  mutation.mockImplementation(async (_name, args) => {
    if (args.token) throw new Error("response lost after commit");
    return { success: true };
  });

  expect(await loadUserGithubToken("alice")).toEqual({
    token: "new",
    username: "alice",
  });
  expect(mutation.mock.calls.filter(([, args]) => args.token)).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("does not fall back to the old version when the save lease has been lost", async () => {
  query.mockResolvedValue(credentials);
  successfulRefresh();
  mutation.mockImplementation(async (_name, args) => ({
    success: !args.token,
  }));

  expect(await loadUserGithubToken("alice")).toBeNull();
  expect(mutation.mock.calls.filter(([, args]) => args.token)).toHaveLength(1);
});

it.each([
  null,
  {
    ...credentials,
    token: "reconnected",
    credentialsVersion: 3,
    expiresAt: now + 3600000,
  },
])(
  "respects disconnect or reconnect during a failed persistence attempt (%j)",
  async (current) => {
    query.mockResolvedValueOnce(credentials).mockResolvedValue(current);
    successfulRefresh();
    mutation.mockImplementation(async (_name, args) => {
      if (args.token) throw new Error("temporary save failure");
      return { success: true };
    });

    expect(await loadUserGithubToken("alice")).toEqual(
      current ? { token: "reconnected", username: "alice" } : null,
    );
    expect(mutation.mock.calls.filter(([, args]) => args.token)).toHaveLength(
      1,
    );
  },
);

it("bounds a stalled persistence request and releases its refresh lease", async () => {
  jest.useFakeTimers({ now });
  query.mockResolvedValue(credentials);
  successfulRefresh();
  mutation.mockImplementation((_name, args) =>
    args.token ? new Promise(() => {}) : Promise.resolve({ success: true }),
  );
  const request = loadUserGithubToken("alice");
  await jest.advanceTimersByTimeAsync(5_001);
  expect(await request).toBeNull();
  expect(mutation.mock.calls.filter(([, args]) => args.token)).toHaveLength(1);
  expect(mutation.mock.calls.at(-1)[1]).not.toHaveProperty("token");
  expect(jest.getTimerCount()).toBe(0);
});

it("fails closed when GitHub rejects an invalid rotated-away refresh token", async () => {
  query.mockResolvedValue(credentials);
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({ error: "bad_refresh_token" }),
  });
  expect(await loadUserGithubToken("alice")).toBeNull();
  expect(mutation.mock.calls.filter(([, args]) => args.token)).toHaveLength(0);
});

it.each([400, 401, 403])(
  "fails closed after GitHub rejects refresh authentication with HTTP %s",
  async (status) => {
    query.mockResolvedValue(credentials);
    (fetch as jest.Mock).mockResolvedValue({ ok: false, status });
    expect(await loadUserGithubToken("alice")).toBeNull();
  },
);

it("keeps explicit credential origins separate for concurrent calls by the same user", async () => {
  const first = {
    query: jest.fn().mockResolvedValue({ token: "origin-a" }),
    mutation: jest.fn(),
  };
  const second = {
    query: jest.fn().mockResolvedValue({ token: "origin-b" }),
    mutation: jest.fn(),
  };
  expect(
    await Promise.all([
      loadUserGithubToken("alice", {
        client: first as never,
        serviceKey: "key-a",
      }),
      loadUserGithubToken("alice", {
        client: second as never,
        serviceKey: "key-b",
      }),
    ]),
  ).toEqual([
    { token: "origin-a", username: undefined },
    { token: "origin-b", username: undefined },
  ]);
  expect(first.query).toHaveBeenCalledWith(expect.anything(), {
    userId: "alice",
    serviceKey: "key-a",
  });
  expect(second.query).toHaveBeenCalledWith(expect.anything(), {
    userId: "alice",
    serviceKey: "key-b",
  });
  expect(query).not.toHaveBeenCalled();
});

it("captures the backend and OAuth configuration before lazy MCP discovery", async () => {
  const bound = {
    query: jest.fn().mockResolvedValue(credentials),
    mutation: jest.fn().mockResolvedValue({ success: true }),
  };
  const loadBound = createGithubTokenLoader({
    client: bound as never,
    serviceKey: "bound-key",
  });
  process.env.GITHUB_OAUTH_CLIENT_ID = "later-client";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "later-secret";
  successfulRefresh();
  expect(await loadBound("alice")).toEqual({ token: "new", username: "alice" });
  expect(bound.query).toHaveBeenCalledWith(expect.anything(), {
    userId: "alice",
    serviceKey: "bound-key",
  });
  expect((fetch as jest.Mock).mock.calls[0][1].body.get("client_id")).toBe(
    "client",
  );
  expect((fetch as jest.Mock).mock.calls[0][1].body.get("client_secret")).toBe(
    "secret",
  );
  expect(query).not.toHaveBeenCalled();
});

it("does not coalesce different service credentials sharing one backend client", async () => {
  const shared = {
    query: jest.fn(async (_name, args) => ({ token: args.serviceKey })),
    mutation: jest.fn(),
  };
  const tokens = await Promise.all([
    loadUserGithubToken("alice", {
      client: shared as never,
      serviceKey: "key-a",
    }),
    loadUserGithubToken("alice", {
      client: shared as never,
      serviceKey: "key-b",
    }),
  ]);
  expect(tokens.map((value) => value?.token)).toEqual(["key-a", "key-b"]);
  expect(shared.query).toHaveBeenCalledTimes(2);
});

it("never replaces a missing explicit origin key with ambient credentials", async () => {
  const bound = { query: jest.fn(), mutation: jest.fn() };
  expect(
    await loadUserGithubToken("alice", {
      client: bound as never,
      serviceKey: "",
    }),
  ).toBeNull();
  expect(
    await createGithubTokenLoader({ client: bound as never, serviceKey: "" })(
      "alice",
    ),
  ).toBeNull();
  expect(bound.query).not.toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
});

it("does not return the old version when a successful refresh body is malformed", async () => {
  query.mockResolvedValue(credentials);
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({ access_token: "new", expires_in: "invalid" }),
  });
  expect(await loadUserGithubToken("alice")).toBeNull();
});
