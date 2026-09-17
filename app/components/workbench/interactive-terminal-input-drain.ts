export interface TerminalInputDrain {
  push(data: string): void;
  stop(): void;
}

/**
 * Keeps at most one remote input mutation in flight. Keystrokes that arrive
 * while that mutation is pending are merged into the next request instead of
 * creating an HTTP/E2B round trip for every character.
 */
export function createTerminalInputDrain(
  send: (data: string) => Promise<void>,
  onError: (error: unknown) => void,
): TerminalInputDrain {
  let pending = "";
  let draining = false;
  let stopped = false;

  const drain = async () => {
    if (draining || stopped) return;
    draining = true;
    try {
      while (!stopped) {
        const data = pending;
        pending = "";
        if (!data) break;
        await send(data);
      }
    } catch (error) {
      stopped = true;
      pending = "";
      onError(error);
    } finally {
      draining = false;
      if (!stopped && pending) void drain();
    }
  };

  return {
    push(data) {
      if (!data || stopped) return;
      pending += data;
      void drain();
    },
    stop() {
      stopped = true;
      pending = "";
    },
  };
}
