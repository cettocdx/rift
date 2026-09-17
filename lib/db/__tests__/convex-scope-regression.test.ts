/** @jest-environment node */
jest.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    auth?: string;
    constructor(public url: string) {
      if (!/^https:\/\/[a-z-]+\.convex\.cloud$/.test(url))
        throw new Error("Invalid deployment URL");
    }
    setAuth(token: string) {
      this.auth = token;
    }
    async query() {
      return { url: this.url, auth: this.auth };
    }
  },
}));
import { getConvexClient, getConvexUrl } from "../convex-client";
import {
  withConvexClientScope,
  bindConvexClientScope,
} from "../convex-client-scope";

const DEFAULT = "https://default-test.convex.cloud";
const A = "https://preview-a.convex.cloud";
const B = "https://preview-b.convex.cloud";
const original = process.env.NEXT_PUBLIC_CONVEX_URL;
beforeEach(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = DEFAULT;
});
afterAll(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL;
  else process.env.NEXT_PUBLIC_CONVEX_URL = original;
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const route = () => (getConvexClient() as any).query();

test("sequential A, B and no-override tasks retain only their own deployment", async () => {
  expect(await withConvexClientScope(A, route)).toEqual({ url: A });
  expect(await withConvexClientScope(B, route)).toEqual({ url: B });
  expect(await withConvexClientScope(undefined, route)).toEqual({
    url: DEFAULT,
  });
  expect(getConvexUrl()).toBe(DEFAULT);
});

test("interleaved tasks retain distinct clients across awaits", async () => {
  const aStarted = deferred(),
    bStarted = deferred();
  const runA = withConvexClientScope(A, async () => {
    const client = getConvexClient();
    aStarted.resolve();
    await bStarted.promise;
    expect(getConvexClient()).toBe(client);
    return route();
  });
  const runB = withConvexClientScope(B, async () => {
    await aStarted.promise;
    const client = getConvexClient();
    bStarted.resolve();
    await Promise.resolve();
    expect(getConvexClient()).toBe(client);
    return route();
  });
  expect(await Promise.all([runA, runB])).toEqual([{ url: A }, { url: B }]);
});

test("same-deployment users do not share mutable client auth", async () => {
  const clientA = withConvexClientScope(A, () => {
    const client = getConvexClient() as any;
    client.setAuth("user-a-token");
    return client;
  });
  const clientB = withConvexClientScope(A, getConvexClient);
  expect(clientB).not.toBe(clientA);
  expect(await (clientB as any).query()).toEqual({ url: A });
});

test("nested success and rejection restore the parent scope", async () => {
  await withConvexClientScope(A, async () => {
    const parent = getConvexClient();
    expect(await withConvexClientScope(B, route)).toEqual({ url: B });
    await expect(
      withConvexClientScope(B, async () => {
        throw new Error("cancelled");
      }),
    ).rejects.toThrow("cancelled");
    expect(getConvexClient()).toBe(parent);
    expect(getConvexUrl()).toBe(A);
  });
  expect(getConvexUrl()).toBe(DEFAULT);
});

test("an omitted nested URL resolves the default rather than inheriting a preview", () => {
  withConvexClientScope(A, () => {
    expect(withConvexClientScope(undefined, getConvexUrl)).toBe(DEFAULT);
    expect(getConvexUrl()).toBe(A);
  });
});

test("a changed default is captured by new runs, not by an already running task", async () => {
  await withConvexClientScope(undefined, async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = B;
    await Promise.resolve();
    // Lazy initialization must still use the entry snapshot.
    expect(await route()).toEqual({ url: DEFAULT });
    expect(withConvexClientScope(undefined, getConvexUrl)).toBe(B);
  });
  expect(await route()).toEqual({ url: B });
});

test("unscoped callers refresh their cache when the environment changes", () => {
  const first = getConvexClient();
  process.env.NEXT_PUBLIC_CONVEX_URL = B;
  expect(getConvexClient()).not.toBe(first);
  expect(getConvexUrl()).toBe(B);
});

test("cancel cleanup invoked by another lifecycle retains the original client", async () => {
  const cleanup = withConvexClientScope(A, () => {
    const client = getConvexClient();
    return bindConvexClientScope(async (reason: string) => {
      await Promise.resolve();
      expect(getConvexClient()).toBe(client);
      return { ...(await route()), reason };
    });
  });
  await withConvexClientScope(B, async () => {
    expect(await cleanup("cancelled")).toEqual({ url: A, reason: "cancelled" });
    expect(getConvexUrl()).toBe(B);
  });
});

test("a pending async completion after cancellation still belongs to its original run", async () => {
  const release = deferred();
  let pending!: Promise<unknown>;
  await expect(
    withConvexClientScope(A, async () => {
      pending = release.promise.then(route);
      throw new Error("cancelled");
    }),
  ).rejects.toThrow("cancelled");
  await withConvexClientScope(B, async () => {
    release.resolve();
    expect(await pending).toEqual({ url: A });
    expect(await route()).toEqual({ url: B });
  });
});

test("bound callbacks restore the caller's scope after a synchronous error", () => {
  const callback = withConvexClientScope(A, () =>
    bindConvexClientScope(() => {
      throw new Error("failure");
    }),
  );
  withConvexClientScope(B, () => {
    expect(callback).toThrow("failure");
    expect(getConvexUrl()).toBe(B);
  });
});

test("binding without a task scope fails instead of capturing a mutable default", () => {
  expect(() => bindConvexClientScope(route)).toThrow(
    "No active Convex task scope",
  );
});

test("missing default fails even when another task used a valid preview", () => {
  withConvexClientScope(A, getConvexClient);
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  withConvexClientScope(undefined, () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = B;
    expect(getConvexClient).toThrow("NEXT_PUBLIC_CONVEX_URL is not set");
  });
});

test.each(["", "invalid", "file:///etc/passwd"])(
  "invalid explicit URL %p never falls back to the default",
  (url) => {
    expect(() => withConvexClientScope(url, getConvexClient)).toThrow();
    expect(getConvexUrl()).toBe(DEFAULT);
  },
);
