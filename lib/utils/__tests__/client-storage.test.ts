import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  readSelectedModel,
  writeSelectedModel,
  clearSelectedModelFromStorage,
  BUILD_REASONING_EFFORTS_STORAGE_KEY,
  hasAuthenticatedBefore,
  markHasAuthenticatedBefore,
  readBuildReasoningEfforts,
  writeBuildReasoningEfforts,
} from "../client-storage";

const STORAGE_KEY = "selected_model";
const LEGACY_ASK_KEY = `${STORAGE_KEY}_ask`;
const LEGACY_AGENT_KEY = `${STORAGE_KEY}_agent`;

describe("client-storage selected model", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe("readSelectedModel", () => {
    it("returns null when nothing is stored", () => {
      expect(readSelectedModel()).toBeNull();
    });

    it("returns the value stored under the unified key", () => {
      window.localStorage.setItem(STORAGE_KEY, "rift-pro");
      expect(readSelectedModel()).toBe("rift-pro");
    });

    it("rejects invalid stored values", () => {
      window.localStorage.setItem(STORAGE_KEY, "not-a-real-model");
      expect(readSelectedModel()).toBeNull();
    });

    it("migrates legacy underlying-model ids to RIFT tiers", () => {
      window.localStorage.setItem(STORAGE_KEY, "opus-4.6");
      expect(readSelectedModel()).toBe("rift-max");
      // The migration rewrites the unified key to the tier id.
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("rift-max");
    });

    it("maps legacy gemini-3-flash and kimi-k2.6 both to rift-standard", () => {
      window.localStorage.setItem(STORAGE_KEY, "gemini-3-flash");
      expect(readSelectedModel()).toBe("rift-standard");

      window.localStorage.setItem(STORAGE_KEY, "kimi-k2.6");
      expect(readSelectedModel()).toBe("rift-standard");
    });

    it("migrates the short-lived rift-lite tier id to rift-standard", () => {
      window.localStorage.setItem(STORAGE_KEY, "rift-lite");
      expect(readSelectedModel()).toBe("rift-standard");
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("rift-standard");
    });

    it("migrates removed Grok ids to rift-standard", () => {
      window.localStorage.setItem(STORAGE_KEY, "grok-4.1");
      expect(readSelectedModel()).toBe("rift-standard");

      window.localStorage.setItem(STORAGE_KEY, "grok-4.3");
      expect(readSelectedModel()).toBe("rift-standard");
    });

    it("does not match inherited Object.prototype keys via the legacy map", () => {
      // Without Object.hasOwn, "toString" / "constructor" would resolve to
      // inherited functions, not SelectedModel values.
      window.localStorage.setItem(STORAGE_KEY, "toString");
      expect(readSelectedModel()).toBeNull();

      window.localStorage.setItem(STORAGE_KEY, "constructor");
      expect(readSelectedModel()).toBeNull();

      window.localStorage.setItem(STORAGE_KEY, "hasOwnProperty");
      expect(readSelectedModel()).toBeNull();
    });

    it("migrates from legacy selected_model_ask key when unified key is empty", () => {
      window.localStorage.setItem(LEGACY_ASK_KEY, "opus-4.6");
      window.localStorage.setItem(LEGACY_AGENT_KEY, "sonnet-4.6");

      expect(readSelectedModel()).toBe("rift-max");
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("rift-max");
      expect(window.localStorage.getItem(LEGACY_ASK_KEY)).toBeNull();
      expect(window.localStorage.getItem(LEGACY_AGENT_KEY)).toBeNull();
    });

    it("falls back to legacy selected_model_agent key when ask is missing", () => {
      window.localStorage.setItem(LEGACY_AGENT_KEY, "kimi-k2.6");

      expect(readSelectedModel()).toBe("rift-standard");
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("rift-standard");
      expect(window.localStorage.getItem(LEGACY_AGENT_KEY)).toBeNull();
    });

    it("ignores legacy keys with unrecognized values and returns null", () => {
      window.localStorage.setItem(LEGACY_ASK_KEY, "totally-fake-model");
      window.localStorage.setItem(LEGACY_AGENT_KEY, "another-bogus-id");

      expect(readSelectedModel()).toBeNull();
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("does not migrate from legacy keys when unified key is already a tier id", () => {
      window.localStorage.setItem(STORAGE_KEY, "rift-pro");
      window.localStorage.setItem(LEGACY_ASK_KEY, "opus-4.6");

      expect(readSelectedModel()).toBe("rift-pro");
      // Legacy key is left alone when unified key is valid.
      expect(window.localStorage.getItem(LEGACY_ASK_KEY)).toBe("opus-4.6");
    });
  });

  describe("writeSelectedModel", () => {
    it("persists under the unified key", () => {
      writeSelectedModel("rift-max");
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("rift-max");
    });
  });

  describe("clearSelectedModelFromStorage", () => {
    it("removes the unified key and legacy per-mode keys", () => {
      window.localStorage.setItem(STORAGE_KEY, "rift-pro");
      window.localStorage.setItem(LEGACY_ASK_KEY, "opus-4.6");
      window.localStorage.setItem(LEGACY_AGENT_KEY, "kimi-k2.6");
      window.localStorage.setItem(
        BUILD_REASONING_EFFORTS_STORAGE_KEY,
        JSON.stringify({ "build-codex": "high" }),
      );

      clearSelectedModelFromStorage();

      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(window.localStorage.getItem(LEGACY_ASK_KEY)).toBeNull();
      expect(window.localStorage.getItem(LEGACY_AGENT_KEY)).toBeNull();
      expect(
        window.localStorage.getItem(BUILD_REASONING_EFFORTS_STORAGE_KEY),
      ).toBeNull();
    });
  });
});

describe("client-storage Build reasoning effort", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists independent valid preferences for each Build model", () => {
    writeBuildReasoningEfforts({
      "build-codex": "xhigh",
      "build-grok": "low",
      "build-kimi": "max",
      "build-qwen": "on",
    });

    expect(readBuildReasoningEfforts()).toEqual({
      "build-codex": "xhigh",
      "build-grok": "low",
      "build-kimi": "max",
      "build-qwen": "on",
    });
  });

  it("drops unsupported, unknown, and malformed stored values", () => {
    window.localStorage.setItem(
      BUILD_REASONING_EFFORTS_STORAGE_KEY,
      JSON.stringify({
        "build-codex": "max",
        "build-retired": "max",
        "build-grok": "xhigh",
        "build-kimi": "high",
        "build-qwen": "high",
        "build-kimi-medium": "medium",
        "build-imaginary": "low",
      }),
    );

    expect(readBuildReasoningEfforts()).toEqual({
      "build-codex": "max",
      "build-kimi": "high",
    });

    window.localStorage.setItem(BUILD_REASONING_EFFORTS_STORAGE_KEY, "[");
    expect(readBuildReasoningEfforts()).toEqual({});
  });
});

describe("client-storage auth marker", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns false before the browser has authenticated", () => {
    expect(hasAuthenticatedBefore()).toBe(false);
  });

  it("persists that this browser has authenticated before", () => {
    markHasAuthenticatedBefore();
    expect(hasAuthenticatedBefore()).toBe(true);
  });
});
