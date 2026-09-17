/** Activity-based idle shutdown; command and PTY execution count as work. */
export class LocalIdleTracker {
  private lastActivityAt: number;
  private activeCommands = 0;
  constructor(
    private now: () => number = Date.now,
    private timeoutMs = 60 * 60 * 1000,
    private keepAlive = false,
  ) {
    this.lastActivityAt = now();
  }
  touch(): void {
    this.lastActivityAt = this.now();
  }
  beginCommand(): () => void {
    this.touch();
    this.activeCommands += 1;
    let completed = false;
    return () => {
      if (completed) return;
      completed = true;
      this.activeCommands -= 1;
      this.touch();
    };
  }
  idleForMs(): number {
    return Math.max(0, this.now() - this.lastActivityAt);
  }
  shouldExpire(hasActivePty: boolean): boolean {
    return (
      !this.keepAlive &&
      !hasActivePty &&
      this.activeCommands === 0 &&
      this.idleForMs() >= this.timeoutMs
    );
  }
}
