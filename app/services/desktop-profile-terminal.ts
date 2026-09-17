import {
  requireDesktopTerminalOwner,
  isCurrentDesktopTerminalOwner,
  type DesktopTerminalOwner,
} from "./desktop-terminal-owner";
import { isTauriEnvironment } from "@/app/hooks/useTauri";
import {
  MAX_WORKBENCH_TERMINAL_INPUT_BYTES,
  WORKBENCH_TERMINAL_PROFILES,
  isWorkbenchTerminalProfile,
  type WorkbenchTerminalProfile,
  type WorkbenchTerminalProfileCapabilities,
} from "@/lib/workbench/interactive-terminal-contract";

export type DesktopProfileTerminalSession = {
  pid: number | null;
  cwd?: string;
  sessionId: string;
  profile: WorkbenchTerminalProfile;
  runtimeLabel: string;
};

export type DesktopProfileTerminalHandle = {
  session: DesktopProfileTerminalSession;
  /** Keeps the Tauri IPC channel alive for the lifetime of the PTY. */
  channel: unknown;
  attachmentId: string;
  owner: DesktopTerminalOwner;
};

type DesktopProfileTerminalCallbacks = {
  onOutput: (chunk: string, rendered: () => void) => void;
  onError?: (error: unknown) => void;
  onClosed?: () => void;
  onExit: (exitCode: number) => void;
  onTruncated?: () => void;
};

const outputStops = new WeakMap<DesktopProfileTerminalHandle, () => void>();
export const MAX_DESKTOP_TERMINAL_OUTPUT_BYTES = 64 * 1024;

function requireDesktop() {
  if (!isTauriEnvironment()) {
    throw new Error("Local CLI profiles are available only in RIFT Desktop.");
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseCapabilities(
  value: unknown,
): WorkbenchTerminalProfileCapabilities {
  const body = asRecord(value);
  if (body?.backend !== "local" || !Array.isArray(body.profiles)) {
    throw new Error(
      "Desktop CLI profile detection returned an invalid response.",
    );
  }

  const profiles = body.profiles.map((value) => {
    const profile = asRecord(value);
    if (
      !profile ||
      !isWorkbenchTerminalProfile(profile.profile) ||
      typeof profile.available !== "boolean" ||
      typeof profile.runtimeLabel !== "string" ||
      (profile.unavailableReason !== null &&
        typeof profile.unavailableReason !== "string")
    ) {
      throw new Error(
        "Desktop CLI profile detection returned an invalid response.",
      );
    }
    return {
      profile: profile.profile,
      available: profile.available,
      runtimeLabel: profile.runtimeLabel,
      unavailableReason: profile.unavailableReason,
    };
  });

  if (
    profiles.length !== WORKBENCH_TERMINAL_PROFILES.length ||
    WORKBENCH_TERMINAL_PROFILES.some(
      ({ id }) => profiles.filter(({ profile }) => profile === id).length !== 1,
    )
  ) {
    throw new Error(
      "Desktop CLI profile detection returned an invalid response.",
    );
  }

  return { backend: "local", profiles };
}

function parseCreatedSession(
  value: unknown,
  expectedProfile: WorkbenchTerminalProfile,
): DesktopProfileTerminalSession {
  const session = asRecord(value);
  if (
    !session ||
    (typeof session.pid !== "number" && session.pid !== null) ||
    typeof session.sessionId !== "string" ||
    session.profile !== expectedProfile ||
    typeof session.runtimeLabel !== "string"
  ) {
    throw new Error("RIFT Desktop returned an invalid terminal session.");
  }

  return {
    pid: session.pid,
    sessionId: session.sessionId,
    profile: expectedProfile,
    runtimeLabel: session.runtimeLabel,
    ...(typeof session.cwd === "string" ? { cwd: session.cwd } : {}),
  };
}

export function createDesktopProfileTerminalSessionId(
  clientTerminalId: string,
) {
  const random = new Uint8Array(8);
  globalThis.crypto.getRandomValues(random);
  const suffix = Array.from(random, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `native_${clientTerminalId}_${suffix}`;
}

export async function listDesktopTerminalProfiles(): Promise<WorkbenchTerminalProfileCapabilities> {
  requireDesktop();
  const { invoke } = await import("@tauri-apps/api/core");
  return parseCapabilities(await invoke("list_desktop_terminal_profiles"));
}

export async function createDesktopProfileTerminal(options: {
  sessionId: string;
  clientTerminalId?: string;
  restart?: boolean;
  profile: WorkbenchTerminalProfile;
  grantId?: string;
  relativeCwd?: string;
  cols: number;
  rows: number;
  callbacks: DesktopProfileTerminalCallbacks;
}): Promise<DesktopProfileTerminalHandle> {
  requireDesktop();
  const ownerRequest = requireDesktopTerminalOwner();
  const [{ invoke, Channel }, owner] = await Promise.all([
    import("@tauri-apps/api/core"),
    ownerRequest,
  ]);
  if (!isCurrentDesktopTerminalOwner(owner))
    throw new Error("Desktop terminal ownership changed.");
  const attachmentId = createDesktopProfileTerminalSessionId("attachment");
  const channel = new Channel<unknown>();
  let session: DesktopProfileTerminalSession | null = null;
  let stopped = false;
  let busy = false;
  let ready: number | null = null;
  let lastSequence: number | null = null;
  const current = () => !stopped && isCurrentDesktopTerminalOwner(owner);
  const identity = () => ({
    ...owner,
    sessionId: session!.sessionId,
    attachmentId,
  });
  const fail = (error: unknown) => {
    if (stopped) return;
    stopped = true;
    if (session)
      void invoke("detach_desktop_profile_pty", identity()).catch(() => {});
    if (isCurrentDesktopTerminalOwner(owner))
      options.callbacks.onError?.(error);
  };
  const readReady = async () => {
    if (!session || ready === null || !current() || busy) return;
    const cursor = ready;
    ready = null;
    busy = true;
    try {
      const result = asRecord(
        await invoke("read_desktop_profile_pty_output", {
          ...identity(),
          cursor,
        }),
      );
      if (!current()) return;
      const data = result?.data;
      const bytes =
        typeof data === "string"
          ? new TextEncoder().encode(data).byteLength
          : 0;
      if (
        result?.sequence !== cursor ||
        typeof data !== "string" ||
        !bytes ||
        bytes > MAX_DESKTOP_TERMINAL_OUTPUT_BYTES ||
        cursor < bytes ||
        (lastSequence !== null && cursor - lastSequence !== bytes)
      ) {
        throw new Error(
          "RIFT Desktop returned invalid terminal output. Reload RIFT.",
        );
      }
      let rendered = false;
      options.callbacks.onOutput(data, () => {
        if (rendered || !current()) return;
        rendered = true;
        lastSequence = cursor;
        busy = false;
        // Only xterm's completion releases native reader credit. A subsequent
        // Ready can arrive before this invocation resolves, after native ACK.
        void invoke("acknowledge_desktop_profile_pty_output", {
          ...identity(),
          cursor,
        }).catch(fail);
      });
    } catch (error) {
      fail(error);
    }
  };
  channel.onmessage = (value) => {
    if (!current()) return;
    const event = asRecord(value);
    if (
      event?.type === "ready" &&
      Number.isSafeInteger(event.sequence) &&
      (event.sequence as number) > 0
    ) {
      if (
        busy ||
        ready !== null ||
        (lastSequence !== null && (event.sequence as number) <= lastSequence)
      ) {
        fail(
          new Error(
            "RIFT Desktop terminal output is out of sequence. Reload RIFT.",
          ),
        );
        return;
      }
      ready = event.sequence as number;
      void readReady();
    } else if (event?.type === "exit" && typeof event.exitCode === "number") {
      if (busy || ready !== null) {
        fail(
          new Error(
            "RIFT Desktop terminal exited before output finished rendering.",
          ),
        );
        return;
      }
      options.callbacks.onExit(event.exitCode);
    } else if (event?.type === "closed") {
      stopped = true;
      if (options.callbacks.onClosed) options.callbacks.onClosed();
      else options.callbacks.onExit(-1);
    } else if (event?.type === "truncated") {
      options.callbacks.onTruncated?.();
    } else {
      fail(new Error("Update RIFT Desktop to use bounded terminal output."));
    }
  };
  const result = await invoke("create_desktop_profile_pty_v2", {
    ...owner,
    sessionId: options.sessionId,
    clientTerminalId: options.clientTerminalId ?? options.sessionId,
    attachmentId,
    restart: options.restart ?? false,
    profile: options.profile,
    grantId: options.grantId ?? null,
    relativeCwd: options.relativeCwd ?? "",
    cols: options.cols,
    rows: options.rows,
    onData: channel,
  }).catch((error: unknown) => {
    stopped = true;
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("create_desktop_profile_pty_v2") &&
      (message.includes("not found") || message.includes("not allowed"))
    ) {
      throw new Error("Update RIFT Desktop to use bounded terminal output.");
    }
    throw error;
  });
  session = parseCreatedSession(result, options.profile);
  const handle = {
    session,
    channel,
    attachmentId,
    owner,
  };
  outputStops.set(handle, () => {
    stopped = true;
  });
  if (!isCurrentDesktopTerminalOwner(owner) || stopped) {
    await detachDesktopProfileTerminal(handle).catch(() => {});
    throw new Error("Desktop terminal ownership changed.");
  }
  void readReady();
  return handle;
}

export async function detachDesktopProfileTerminal(
  handle: DesktopProfileTerminalHandle,
): Promise<void> {
  outputStops.get(handle)?.();
  outputStops.delete(handle);
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("detach_desktop_profile_pty", {
    ...handle.owner,
    sessionId: handle.session.sessionId,
    attachmentId: handle.attachmentId,
  });
}

export async function closeDesktopProfileTerminalTab(
  clientTerminalId: string,
): Promise<void> {
  requireDesktop();
  const ownerRequest = requireDesktopTerminalOwner();
  const [{ invoke }, owner] = await Promise.all([
    import("@tauri-apps/api/core"),
    ownerRequest,
  ]);
  if (!isCurrentDesktopTerminalOwner(owner))
    throw new Error("Desktop terminal ownership changed.");
  await invoke("close_desktop_profile_terminal", {
    ...owner,
    clientTerminalId,
  });
}

export async function sendDesktopProfileTerminalInput(
  sessionId: string,
  data: string,
): Promise<void> {
  requireDesktop();
  const ownerRequest = requireDesktopTerminalOwner();
  const [{ invoke }, owner] = await Promise.all([
    import("@tauri-apps/api/core"),
    ownerRequest,
  ]);
  if (!isCurrentDesktopTerminalOwner(owner))
    throw new Error("Desktop terminal ownership changed.");
  const encoder = new TextEncoder();
  let chunk = "";
  let chunkBytes = 0;

  for (const character of data) {
    const characterBytes = encoder.encode(character).byteLength;
    if (
      chunk &&
      chunkBytes + characterBytes > MAX_WORKBENCH_TERMINAL_INPUT_BYTES
    ) {
      if (!isCurrentDesktopTerminalOwner(owner))
        throw new Error("Desktop terminal ownership changed.");
      await invoke("send_desktop_profile_pty_input", {
        ...owner,
        sessionId,
        data: chunk,
      });
      chunk = "";
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += characterBytes;
  }

  if (chunk) {
    if (!isCurrentDesktopTerminalOwner(owner))
      throw new Error("Desktop terminal ownership changed.");
    await invoke("send_desktop_profile_pty_input", {
      ...owner,
      sessionId,
      data: chunk,
    });
  }
}

export async function resizeDesktopProfileTerminal(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  requireDesktop();
  const ownerRequest = requireDesktopTerminalOwner();
  const [{ invoke }, owner] = await Promise.all([
    import("@tauri-apps/api/core"),
    ownerRequest,
  ]);
  if (!isCurrentDesktopTerminalOwner(owner))
    throw new Error("Desktop terminal ownership changed.");
  await invoke("resize_desktop_profile_pty", {
    ...owner,
    sessionId,
    cols,
    rows,
  });
}

export async function killDesktopProfileTerminal(
  sessionId: string,
): Promise<void> {
  requireDesktop();
  const ownerRequest = requireDesktopTerminalOwner();
  const [{ invoke }, owner] = await Promise.all([
    import("@tauri-apps/api/core"),
    ownerRequest,
  ]);
  if (!isCurrentDesktopTerminalOwner(owner))
    throw new Error("Desktop terminal ownership changed.");
  await invoke("kill_desktop_profile_pty", {
    ...owner,
    sessionId,
  });
}
