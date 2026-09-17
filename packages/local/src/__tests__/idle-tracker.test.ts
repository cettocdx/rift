/** @jest-environment node */
import { LocalIdleTracker } from "../idle-tracker";

const HOUR = 60 * 60 * 1000;
let now: number;
let activity: LocalIdleTracker;
beforeEach(() => {
  now = 0;
  activity = new LocalIdleTracker(() => now);
});
test("an unused connection expires after a full idle hour", () => {
  now = HOUR - 1;
  expect(activity.shouldExpire(false)).toBe(false);
  now = HOUR;
  expect(activity.shouldExpire(false)).toBe(true);
});
test("a silent streamed command remains alive beyond the idle hour", () => {
  activity.beginCommand();
  now = HOUR * 2;
  expect(activity.shouldExpire(false)).toBe(false);
});
test("an open PTY remains alive even without new input or output", () => {
  now = HOUR * 2;
  expect(activity.shouldExpire(true)).toBe(false);
});
test("idle countdown starts after a long command completes", () => {
  const finish = activity.beginCommand();
  now = HOUR * 2;
  finish();
  now += HOUR - 1;
  expect(activity.shouldExpire(false)).toBe(false);
  now += 1;
  expect(activity.shouldExpire(false)).toBe(true);
});
test("one completed command cannot make overlapping work idle", () => {
  const first = activity.beginCommand();
  const second = activity.beginCommand();
  now = HOUR * 2;
  first();
  now += HOUR * 2;
  expect(activity.shouldExpire(false)).toBe(false);
  second();
  expect(activity.shouldExpire(false)).toBe(false);
});
test("repeated cleanup of one command cannot alter later idle time", () => {
  const finish = activity.beginCommand();
  now = 100;
  finish();
  now += HOUR;
  finish();
  expect(activity.shouldExpire(false)).toBe(true);
});
test("PTY exit or new activity restarts idle time", () => {
  now = HOUR * 2;
  activity.touch();
  now += HOUR - 1;
  expect(activity.shouldExpire(false)).toBe(false);
  now += 1;
  expect(activity.shouldExpire(false)).toBe(true);
});

test("managed runner remains available across idle days", () => {
  const managed = new LocalIdleTracker(() => now, HOUR, true);
  now = HOUR * 48;
  expect(managed.shouldExpire(false)).toBe(false);
});
