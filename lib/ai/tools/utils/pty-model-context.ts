import type { AnySandbox } from "@/types";
import type { getSessionSnapshots } from "./pty-output-formatter";
import { saveFullOutputToFile } from "./terminal-output-saver";

export interface PtyModelContext {
  screen: string;
  scrollback: {
    path: string;
    characters: number;
    scope: "retained PTY snapshot";
  };
}

// One successful receipt per session; sessions are owned by the existing PTY
// manager. Weak keys neither extend their lifetime nor accumulate poll history.
const receipts = new WeakMap<
  object,
  {
    cleaned: string;
    path: Promise<string | null>;
  }
>();

/** Save before projecting: if evidence cannot be preserved, keep it inline. */
export async function preservePtyModelContext(
  session: object,
  snapshots: Awaited<ReturnType<typeof getSessionSnapshots>>,
  getSandbox: () => Promise<AnySandbox>,
): Promise<PtyModelContext | undefined> {
  if (snapshots.cleaned.length <= 8192 || snapshots.screen === undefined) {
    return undefined;
  }
  let receipt = receipts.get(session);
  if (!receipt || receipt.cleaned !== snapshots.cleaned) {
    const save = (async () => {
      try {
        return await saveFullOutputToFile(
          await getSandbox(),
          snapshots.cleaned,
          true,
        );
      } catch {
        return null;
      }
    })();
    // Saving is optional: a stalled sandbox transport must not stall the run.
    // A late write is harmless (content-addressed) but is not advertised.
    const path = new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000);
      timer.unref?.();
      void save.then((saved) => {
        clearTimeout(timer);
        resolve(saved);
      });
    });
    receipt = { cleaned: snapshots.cleaned, path };
    receipts.set(session, receipt);
  }
  const path = await receipt.path;
  if (!path) {
    if (receipts.get(session) === receipt) receipts.delete(session);
    return undefined;
  }
  return {
    screen: snapshots.screen,
    scrollback: {
      path,
      characters: snapshots.cleaned.length,
      scope: "retained PTY snapshot",
    },
  };
}
