import { onOpenCommandPalette, openCommandPalette } from "../command-palette";

describe("command palette event", () => {
  it("carries an optional initial search query to the mounted palette", () => {
    const listener = jest.fn();
    const unsubscribe = onOpenCommandPalette(listener);

    try {
      openCommandPalette({ query: "quarterly dashboard" });
      expect(listener).toHaveBeenCalledWith({ query: "quarterly dashboard" });
    } finally {
      unsubscribe();
    }
  });
});
