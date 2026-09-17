import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { navigateToAuth } from "../useTauri";

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}));

jest.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
  },
}));

const mockInvoke = invoke as jest.Mock;
const mockOpenUrl = openUrl as jest.Mock;
const mockToastError = toast.error as jest.Mock;
let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

function setTauriEnvironment() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
}

describe("navigateToAuth", () => {
  beforeEach(() => {
    setTauriEnvironment();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockOpenUrl.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: undefined,
    });
  });

  it("opens desktop login with a desktop auth state when supported", async () => {
    const desktopAuthState = "a".repeat(64);
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "prepare_desktop_auth_state") {
        return desktopAuthState;
      }
      if (command === "get_dev_auth_port") {
        return 0;
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await navigateToAuth("/signup?returnTo=%2Fsettings");

    expect(mockOpenUrl).toHaveBeenCalledWith(
      `http://localhost/desktop-login?returnTo=%2Fsettings&desktop_state=${desktopAuthState}&screen_hint=sign-up`,
    );
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("includes the loopback callback port for desktop development", async () => {
    const desktopAuthState = "b".repeat(64);
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "prepare_desktop_auth_state") {
        return desktopAuthState;
      }
      if (command === "get_dev_auth_port") {
        return 43127;
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await navigateToAuth("/login?returnTo=%2Fstudio");

    expect(mockOpenUrl).toHaveBeenCalledWith(
      `http://localhost/desktop-login?returnTo=%2Fstudio&desktop_state=${desktopAuthState}&dev_callback_port=43127`,
    );
  });

  it("does not open a browser for an invalid native auth state", async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "prepare_desktop_auth_state") return "invalid";
      throw new Error(`Unexpected command: ${command}`);
    });

    await navigateToAuth("/login");

    expect(mockOpenUrl).not.toHaveBeenCalled();
  });

  it("falls back to in-webview sign-in when the desktop auth bridge is missing", async () => {
    mockInvoke.mockRejectedValue(new Error("unknown command"));

    await navigateToAuth("/login");

    // No "update your desktop" toast and no external browser bridge — sign-in
    // happens directly inside the app webview (Password auth needs no redirect).
    expect(mockToastError).not.toHaveBeenCalled();
    expect(mockOpenUrl).not.toHaveBeenCalled();
  });
});
