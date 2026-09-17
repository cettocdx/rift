import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { IndependentConsoleClient } from "./independent-client.js";
import { validateAppUrl } from "./session.js";
const directory =
  process.env.RIFT_CONFIG_DIR || join(homedir(), ".config", "rift");
const configPath = join(directory, "console.json");
type Settings = {
  app: string;
  apiKey: string;
  sessions?: Record<string, string>;
};
export async function readSettings(): Promise<Settings | null> {
  try {
    return JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    return null;
  }
}
async function save(settings: Settings) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(configPath, JSON.stringify(settings), { mode: 0o600 });
  await chmod(configPath, 0o600);
}
export async function login(app: string, open: (url: string) => Promise<void>) {
  const origin = validateAppUrl(app).origin;
  const nonce = randomBytes(32).toString("hex");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Login expired. Run rift login again."));
    }, 300_000);
    const server = createServer(async (req, res) => {
      if (
        req.headers.origin !== origin ||
        req.headers.host !==
          `127.0.0.1:${(server.address() as { port: number }).port}`
      ) {
        res.writeHead(403).end();
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      if (req.method === "OPTIONS") {
        res.writeHead(204).end();
        return;
      }
      if (req.method !== "POST" || req.url !== "/login") {
        res.writeHead(404).end();
        return;
      }
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) {
          res.writeHead(413).end();
          return;
        }
      }
      try {
        const value = JSON.parse(body);
        if (
          value.state !== nonce ||
          !/^rift_live_[a-f0-9]{64}$/.test(value.key)
        )
          throw new Error();
        await save({ app: origin, apiKey: value.key });
        res.end("ok");
        clearTimeout(timer);
        server.close();
        resolve();
      } catch {
        res.writeHead(400).end();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      const url = new URL("/console-login", origin);
      url.hash = new URLSearchParams({
        port: String(port),
        state: nonce,
      }).toString();
      void open(url.toString()).catch((error) => {
        clearTimeout(timer);
        server.close();
        reject(error);
      });
    });
    server.on("error", reject);
  });
}
export async function createStandaloneSession(
  app: string,
  cwd: string,
  resume = true,
) {
  const settings = await readSettings();
  const origin = validateAppUrl(app).origin;
  const key =
    process.env.RIFT_API_KEY ||
    (settings?.app === origin ? settings.apiKey : undefined);
  if (!key) throw new Error(`Sign in first: rift --app ${origin} login`);
  const workspace = createHash("sha256")
    .update("independent-v2\n" + origin + "\n" + cwd)
    .digest("hex");
  const events = new EventEmitter();
  const client = new IndependentConsoleClient(
    ((path, init) =>
      fetch(new URL(String(path), origin), {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          Authorization: `Bearer ${key}`,
        },
      })) as typeof fetch,
    resume ? settings?.sessions?.[workspace] : undefined,
    (id) => {
      if (settings?.app === origin) {
        settings.sessions = { ...settings.sessions, [workspace]: id };
        void save(settings);
      }
    },
  );
  client.subscribe(() => events.emit("snapshot"));
  await client.initialize();
  return {
    events,
    port: 0,
    sessionId: client.snapshot.chatId!,
    pairingUrl: origin,
    appUrl: origin,
    get snapshot() {
      return client.snapshot;
    },
    get connected() {
      return client.snapshot.status !== "unavailable";
    },
    send: client.send.bind(client),
    async close() {
      client.close();
    },
  };
}

/** Local execution uses the same RIFT identity, but never creates an app chat. */
export async function createLocalSession(
  app: string,
  cwd: string,
  resume = true,
) {
  const { LocalConsoleClient } = await import("./local-client.js");
  const { open, rename, unlink, realpath } = await import("node:fs/promises");
  const root = await realpath(cwd);
  const settings = await readSettings();
  const origin = validateAppUrl(app).origin;
  const key =
    process.env.RIFT_API_KEY ||
    (settings?.app === origin ? settings.apiKey : undefined);
  if (!key) throw new Error(`Sign in first: rift --app ${origin} login`);
  const hash = createHash("sha256")
    .update(origin + "\n" + root)
    .digest("hex");
  const sessions = join(directory, "sessions");
  await mkdir(sessions, { recursive: true, mode: 0o700 });
  const latestPath = join(sessions, hash + ".latest");
  let filename = hash + ".json";
  if (resume) {
    try {
      const latest = (await readFile(latestPath, "utf8")).trim();
      if (new RegExp(`^${hash}-[a-f0-9-]+\\.json$`).test(latest))
        filename = latest;
    } catch {}
  } else filename = hash + "-" + crypto.randomUUID() + ".json";
  const path = join(sessions, filename);
  const lockPath = path + ".lock";
  // One writer per local session. A second terminal must use another directory.
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(await readFile(lockPath, "utf8"));
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH") alive = false;
    }
    if (alive)
      throw new Error(
        "RIFT is already running in this directory. Close that terminal session first.",
      );
    await unlink(lockPath);
    lock = await open(lockPath, "wx", 0o600);
  }
  await lock.writeFile(String(process.pid));
  await lock.close();
  const release = () => unlink(lockPath).catch(() => undefined);
  try {
    let state: import("./local-client.js").LocalState;
    try {
      state = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      state = { id: crypto.randomUUID(), messages: [], entries: [] };
    }
    if (
      !Array.isArray(state.messages) ||
      !Array.isArray(state.entries) ||
      typeof state.id !== "string"
    )
      throw new Error(
        "Saved terminal session is invalid. Preserve it before starting a new one.",
      );
    let instructions = "";
    try {
      instructions = (await readFile(join(root, "AGENTS.md"), "utf8")).slice(
        0,
        32000,
      );
    } catch {}
    let writes = Promise.resolve();
    const persist = (value: import("./local-client.js").LocalState) => {
      writes = writes.then(async () => {
        const temp = path + "." + process.pid + ".tmp";
        await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
        await rename(temp, path);
      });
      return writes;
    };
    const client = new LocalConsoleClient(
      ((p, init) =>
        fetch(new URL(String(p), origin), {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            Authorization: `Bearer ${key}`,
          },
        })) as typeof fetch,
      root,
      state,
      persist,
      instructions,
    );
    const events = new EventEmitter();
    client.subscribe(() => events.emit("snapshot"));
    await client.initialize();
    await writeFile(latestPath, filename, { mode: 0o600 });
    return {
      events,
      port: 0,
      sessionId: client.snapshot.chatId!,
      pairingUrl: origin,
      appUrl: origin,
      get snapshot() {
        return client.snapshot;
      },
      get connected() {
        return client.snapshot.status !== "unavailable";
      },
      send: client.send.bind(client),
      async close() {
        try {
          await client.shutdown();
          await writes;
        } finally {
          await release();
        }
      },
    };
  } catch (error) {
    await release();
    throw error;
  }
}
