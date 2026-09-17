import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import {
  CONSOLE_MAX_MESSAGE_BYTES,
  CONSOLE_PROTOCOL,
  CONSOLE_SOCKET_PATH,
  isConsoleAppMessage,
  isConsoleCommand,
  type ConsoleCommand,
  type ConsoleSnapshot,
  type ConsoleServerMessage,
} from "./protocol.js";

export class ConsoleCommandError extends Error {
  constructor(
    message: string,
    public readonly uncertain = false,
  ) {
    super(message);
  }
}

export function validateAppUrl(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password)
    throw new Error("The app URL must not contain credentials.");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(
      "Use an HTTPS RIFT app URL, or HTTP on localhost for development.",
    );
  }
  if (url.hash) throw new Error("The app URL must not contain a fragment.");
  return url;
}

/** A loopback capability connects a terminal to one explicitly approved app tab. */
export async function createConsoleSession(options: {
  appUrl: string;
  cwd: string;
  requestTimeoutMs?: number;
  heartbeatMs?: number;
}) {
  const appUrl = validateAppUrl(options.appUrl);
  const secret = randomBytes(32).toString("base64url");
  const sessionId = randomUUID();
  const events = new EventEmitter();
  const pending = new Map<
    string,
    {
      resolve: () => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let socket: WebSocket | null = null;
  let snapshot: ConsoleSnapshot | null = null;
  let closed = false;
  let pongReceived = true;
  const server = createServer((_req, res) => {
    res.writeHead(403, {
      "Content-Type": "text/plain",
      "Cache-Control": "no-store",
    });
    res.end("This endpoint accepts an explicitly paired RIFT app only.");
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: CONSOLE_MAX_MESSAGE_BYTES,
    handleProtocols: (protocols) =>
      protocols.has(CONSOLE_PROTOCOL) ? CONSOLE_PROTOCOL : false,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const port = (server.address() as { port: number }).port;
  const pairingUrl = new URL(appUrl);
  pairingUrl.hash = `riftConsole=${port}:${secret}`;

  function rejectPending(message: string) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new ConsoleCommandError(message, true));
    }
    pending.clear();
  }
  function authorised(req: IncomingMessage) {
    const protocols = String(req.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((part) => part.trim());
    const offered =
      protocols
        .find((part) => part.startsWith("rift-") && part !== CONSOLE_PROTOCOL)
        ?.slice(5) ?? "";
    const a = Buffer.from(offered);
    const b = Buffer.from(secret);
    return (
      req.socket.remoteAddress === "127.0.0.1" &&
      req.headers.host === `127.0.0.1:${port}` &&
      req.url === CONSOLE_SOCKET_PATH &&
      req.headers.origin === appUrl.origin &&
      protocols.includes(CONSOLE_PROTOCOL) &&
      a.length === b.length &&
      timingSafeEqual(a, b)
    );
  }
  server.on("upgrade", (req, transport, head) => {
    if (closed || !authorised(req)) {
      transport.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    if (socket !== null) {
      transport.end("HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, transport, head, (client) => {
      socket = client;
      snapshot = null;
      pongReceived = true;
      client.on("pong", () => {
        pongReceived = true;
      });
      client.on("error", () => client.terminate());
      client.on("close", () => {
        if (socket !== client) return;
        socket = null;
        snapshot = null;
        rejectPending(
          "Connection lost. The action may have reached RIFT; check the app before retrying.",
        );
        events.emit("disconnected");
      });
      client.on("message", (bytes, binary) => {
        if (binary) {
          client.close(1003, "Text messages required");
          return;
        }
        let message: unknown;
        try {
          message = JSON.parse(bytes.toString());
        } catch {
          client.close(1007, "Invalid JSON");
          return;
        }
        if (!isConsoleAppMessage(message)) {
          client.close(1008, "Invalid console message");
          return;
        }
        if (message.type === "snapshot") {
          snapshot = message.snapshot;
          events.emit("snapshot", snapshot);
        } else {
          const entry = pending.get(message.id);
          if (!entry) return;
          pending.delete(message.id);
          clearTimeout(entry.timer);
          if (message.accepted) entry.resolve();
          else
            entry.reject(
              new ConsoleCommandError(
                message.error || "RIFT did not accept this action.",
              ),
            );
        }
      });
      const greeting: ConsoleServerMessage = {
        type: "connected",
        version: 1,
        sessionId,
        cwd: options.cwd,
      };
      client.send(JSON.stringify(greeting));
      events.emit("connected");
    });
  });
  server.on("error", () =>
    events.emit(
      "connection-error",
      "The local console connection encountered an error.",
    ),
  );
  const heartbeat = setInterval(() => {
    if (!socket) return;
    if (!pongReceived) {
      socket.terminate();
      return;
    }
    pongReceived = false;
    socket.ping();
  }, options.heartbeatMs ?? 30_000);
  heartbeat.unref();

  function send(command: ConsoleCommand): Promise<void> {
    if (!isConsoleCommand(command))
      return Promise.reject(
        new ConsoleCommandError("Invalid console command."),
      );
    const client = socket;
    const current = snapshot;
    if (
      !client ||
      client.readyState !== WebSocket.OPEN ||
      !current ||
      (current.status === "unavailable" && command.type !== "new-chat")
    ) {
      return Promise.reject(
        new ConsoleCommandError("Connect and sign in to the RIFT app first."),
      );
    }
    if ("chatId" in command && command.chatId !== current.chatId) {
      return Promise.reject(
        new ConsoleCommandError(
          "The active conversation changed. Review the current conversation before sending.",
        ),
      );
    }
    if (
      command.type === "approve" &&
      !current.approvals.some((approval) => approval.id === command.id)
    ) {
      return Promise.reject(
        new ConsoleCommandError("This approval is no longer pending."),
      );
    }
    const choices =
      command.type === "set-model"
        ? current.models
        : command.type === "set-effort"
          ? current.efforts
          : command.type === "set-target"
            ? current.targets
            : command.type === "set-mode"
              ? current.modes
              : command.type === "set-approval"
                ? current.permissions
                : null;
    if (
      "value" in command &&
      !choices?.some((choice) => choice.value === command.value)
    ) {
      return Promise.reject(
        new ConsoleCommandError(
          "This setting is not available in the current RIFT session.",
        ),
      );
    }
    if (pending.size >= 8)
      return Promise.reject(
        new ConsoleCommandError(
          "Wait for RIFT to acknowledge the current actions.",
        ),
      );
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new ConsoleCommandError(
            "RIFT did not acknowledge this action. It may have been applied; check the app before retrying.",
            true,
          ),
        );
      }, options.requestTimeoutMs ?? 20_000);
      pending.set(id, { resolve, reject, timer });
      const message: ConsoleServerMessage = { type: "command", id, command };
      client.send(JSON.stringify(message), (error) => {
        if (!error || !pending.has(id)) return;
        pending.delete(id);
        clearTimeout(timer);
        reject(
          new ConsoleCommandError(
            "The action could not be confirmed. Check the app before retrying.",
            true,
          ),
        );
      });
    });
  }
  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    rejectPending(
      "Console closed. Check RIFT for any action already submitted.",
    );
    socket?.terminate();
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return {
    events,
    port,
    sessionId,
    pairingUrl: pairingUrl.toString(),
    appUrl: appUrl.toString(),
    get snapshot() {
      return snapshot;
    },
    get connected() {
      return socket?.readyState === WebSocket.OPEN;
    },
    send,
    close,
  };
}

export type ConsoleSession = Awaited<ReturnType<typeof createConsoleSession>>;
