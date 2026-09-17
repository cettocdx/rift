/** @jest-environment node */
import { getSessionSnapshots } from "../pty-output-formatter";

const snapshots = (text: string) =>
  getSessionSnapshots({ snapshot: () => new TextEncoder().encode(text) }, {
    chatId: "fixture",
    sessionId: "fixture",
    cols: 120,
    rows: 30,
  } as any);

test("current screen preserves absolute cursor edits at real PTY geometry", async () => {
  const raw =
    "old scrollback\r\n".repeat(100) +
    "\x1b[2J\x1b[HMenu\x1b[30;1HChoose option>";
  const result = (await snapshots(raw)) as any;
  expect(result.screen).toContain("Menu");
  expect(result.screen).toContain("Choose option>");
  expect(result.screen).not.toContain("old scrollback");
  expect(result.screen.split("\n")).toHaveLength(30);
  expect(result.raw).toBe(raw);
});

test("alternate-screen prompts retain top and bottom rows without normal scrollback", async () => {
  const result = (await snapshots(
    "old scrollback\r\n".repeat(100) +
      "\x1b[?1049h\x1b[HInstaller\x1b[30;1HConfirm [y/n]",
  )) as any;
  expect(result.screen).toContain("Installer");
  expect(result.screen).toContain("Confirm [y/n]");
  expect(result.screen).not.toContain("old scrollback");
});

test("leaving an alternate screen restores the shell screen without stale TUI content", async () => {
  const result = (await snapshots(
    "Shell prompt>\x1b[?1049h\x1b[HInstaller\x1b[?1049l",
  )) as any;
  expect(result.screen).toContain("Shell prompt>");
  expect(result.screen).not.toContain("Installer");
});
