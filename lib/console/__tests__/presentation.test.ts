import type { UIMessage } from "ai";
import { consoleEntries, consoleText } from "../presentation";
import { parseConsolePairing, withoutConsolePairing } from "../pairing";

describe("RIFT console projection", () => {
  it("keeps observed work in transcript order without exporting hidden metadata", () => {
    const messages = [
      {
        id: "one",
        role: "assistant",
        parts: [
          { type: "text", text: "Checking the file." },
          {
            type: "tool-read_file",
            state: "output-available",
            input: { path: "src/app.ts" },
            output: { text: "private raw tool payload" },
          },
          { type: "reasoning", text: "provider thought data", state: "done" },
          { type: "data-internal", data: "internal payload" },
          { type: "text", text: "The file is ready." },
        ],
      },
    ] as UIMessage[];
    const result = consoleEntries(messages, "ready");
    expect(result.map((e) => e.kind)).toEqual([
      "assistant",
      "activity",
      "activity",
      "assistant",
    ]);
    expect(result[1].text).toMatch(/Read.*app.ts/);
    expect(JSON.stringify(result)).not.toMatch(
      /private raw|provider thought|internal payload/,
    );
  });
  it("removes ANSI/OSC and bidi instructions while retaining Unicode and line breaks", () => {
    expect(
      consoleText("Türkçe\n\x1b[31mred\x1b[0m\x1b]52;c;secret\x07\u202Eend"),
    ).toBe("Türkçe\nredend");
  });
  it("bounds history while retaining the newest response and visible history marker", () => {
    const messages = Array.from({ length: 80 }, (_, i) => ({
      id: String(i),
      role: "assistant",
      parts: [{ type: "text", text: String(i).padEnd(5000, "x") }],
    })) as UIMessage[];
    const result = consoleEntries(messages, "ready");
    expect(result.at(-1)?.id).toBe("79:0");
    expect(result[0].id).toBe("older-history");
    expect(result.reduce((sum, e) => sum + e.text.length, 0)).toBeLessThan(
      100100,
    );
  });
});

describe("local console pairing", () => {
  const token = "a".repeat(43);
  it("accepts only a loopback port and capability, never an arbitrary host", () => {
    expect(parseConsolePairing(`#riftConsole=53421:${token}`)).toEqual({
      port: 53421,
      token,
    });
    for (const invalid of [
      `#riftConsole=80:${token}`,
      `#riftConsole=99999:${token}`,
      "#riftConsole=1234:short",
      `#riftConsole=evil.example:53421:${token}`,
    ])
      expect(parseConsolePairing(invalid)).toBeNull();
  });
  it("removes pairing from history without discarding unrelated fragment parameters", () => {
    expect(
      withoutConsolePairing(`#pane=console&riftConsole=53421:${token}`),
    ).toBe("#pane=console");
    expect(withoutConsolePairing(`#riftConsole=53421:${token}`)).toBe("");
  });
});
