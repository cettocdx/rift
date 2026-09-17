export const TERMINAL_OUTPUT_BATCH_BYTES = 64 * 1024;

/** One native read, one xterm parse, then render ACK. Never buffers a producer
 * that violates credit: failing closed keeps stalled rendering memory bounded.
 */
export function createTerminalOutputDrain(
  write: (bytes: Uint8Array, complete: () => void) => void,
  onError: (error: unknown) => void,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;
  let stopped = false;
  let ended = false;
  let onDrained: (() => void) | null = null;
  const stop = () => {
    stopped = true;
    onDrained = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    push(text: string, rendered?: () => void) {
      if (stopped || ended) return;
      const bytes = new TextEncoder().encode(text);
      if (busy || bytes.byteLength > TERMINAL_OUTPUT_BATCH_BYTES) {
        stop();
        onError(
          new Error(
            "Desktop terminal exceeded its render window. Reload RIFT.",
          ),
        );
        return;
      }
      busy = true;
      timer = setTimeout(() => {
        timer = null;
        let acknowledged = false;
        try {
          write(bytes, () => {
            if (acknowledged || stopped) return;
            acknowledged = true;
            busy = false;
            rendered?.();
            const complete = onDrained;
            onDrained = null;
            complete?.();
          });
        } catch (error) {
          stop();
          onError(error);
        }
      }, 0);
    },
    finish(complete: () => void) {
      if (stopped || ended) return;
      ended = true;
      if (busy) onDrained = complete;
      else complete();
    },
    stop,
  };
}
