import type { PtyOutputFlowControl } from "@/lib/ai/tools/utils/e2b-pty-adapter";

/** Each attachment holds its own credit. A fast reader cannot resume a PTY
 * while another attached reader still has unconsumed output. */
export function createTerminalOutputFlow(
  pause: () => void,
  resume: () => void,
) {
  const holders = new Set<symbol>();
  return (): PtyOutputFlowControl => {
    const owner = Symbol();
    let disposed = false;
    const release = () => {
      if (holders.delete(owner) && holders.size === 0) resume();
    };
    return {
      pause() {
        if (disposed || holders.has(owner)) return;
        const first = holders.size === 0;
        holders.add(owner);
        if (first) pause();
      },
      resume: release,
      dispose() {
        disposed = true;
        release();
      },
    };
  };
}
