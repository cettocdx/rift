import { invoke } from "@tauri-apps/api/core";
import {
  invalidateDesktopTerminalOwner,
  requireDesktopTerminalOwner,
  synchronizeDesktopTerminalOwner,
} from "../desktop-terminal-owner";

jest.mock("@/app/hooks/useTauri", () => ({ isTauriEnvironment: () => true }));
jest.mock("@tauri-apps/api/core", () => ({ invoke: jest.fn() }));
const mockInvoke = jest.mocked(invoke);
beforeEach(() => {
  invalidateDesktopTerminalOwner();
  mockInvoke.mockReset();
});

it("reuses resolved ownership for the same account and synchronizes an account switch", async () => {
  mockInvoke.mockResolvedValueOnce(7).mockResolvedValueOnce(8);
  const owner = await synchronizeDesktopTerminalOwner("account-a");
  expect(await synchronizeDesktopTerminalOwner("account-a")).toBe(owner);
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(await synchronizeDesktopTerminalOwner("account-b")).toEqual({
    ownerId: "account-b",
    ownerGeneration: 8,
  });
});

it("discards a pending auth synchronization before it reaches native after signout", async () => {
  const pending = synchronizeDesktopTerminalOwner("account-a");
  invalidateDesktopTerminalOwner();
  await expect(pending).rejects.toThrow("ownership changed");
  expect(mockInvoke).not.toHaveBeenCalled();
  await expect(requireDesktopTerminalOwner()).rejects.toThrow("Sign in");
});

it("rejects a late native ownership result after disconnect", async () => {
  let resolve!: (value: number) => void;
  mockInvoke.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }) as ReturnType<typeof invoke>,
  );
  const pending = synchronizeDesktopTerminalOwner("account-a");
  await Promise.resolve();
  await Promise.resolve();
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  invalidateDesktopTerminalOwner();
  resolve(7);
  await expect(pending).rejects.toThrow("ownership changed");
});

it("clearly requires an updated native shell when the durable protocol is absent", async () => {
  mockInvoke.mockRejectedValue(
    "Command synchronize_desktop_terminal_owner not found",
  );
  await expect(synchronizeDesktopTerminalOwner("account-a")).rejects.toThrow(
    "Update RIFT Desktop",
  );
});

it("retries a failed same-account handshake instead of caching its rejection forever", async () => {
  mockInvoke
    .mockRejectedValueOnce(new Error("temporary IPC failure"))
    .mockResolvedValueOnce(9);
  await expect(synchronizeDesktopTerminalOwner("account-a")).rejects.toThrow(
    "temporary",
  );
  expect(await requireDesktopTerminalOwner()).toEqual({
    ownerId: "account-a",
    ownerGeneration: 9,
  });
  expect(mockInvoke).toHaveBeenCalledTimes(2);
});
