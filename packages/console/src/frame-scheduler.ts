/** Input and stream updates must never wait behind a slower decorative frame. */
export class FrameScheduler {
  private update?: ReturnType<typeof setTimeout>;
  private animation?: ReturnType<typeof setTimeout>;
  private priority = Infinity;
  private stopped = false;
  constructor(private paint: () => void) {}
  request(delay = 16) {
    if (this.stopped || (this.update && this.priority <= delay)) return;
    clearTimeout(this.update);
    this.priority = delay;
    this.update = setTimeout(() => {
      this.update = undefined;
      this.priority = Infinity;
      this.paint();
    }, delay);
  }
  animateAfter(delay: number | undefined) {
    clearTimeout(this.animation);
    this.animation = undefined;
    if (delay === undefined || this.stopped) return;
    this.animation = setTimeout(() => {
      this.animation = undefined;
      this.request();
    }, delay);
  }
  close() {
    this.stopped = true;
    clearTimeout(this.update);
    clearTimeout(this.animation);
  }
}
