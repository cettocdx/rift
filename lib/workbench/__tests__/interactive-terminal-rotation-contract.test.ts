import fs from "node:fs";
import path from "node:path";

const serverSource = fs.readFileSync(
  path.resolve(__dirname, "../interactive-terminal.ts"),
  "utf8",
);
const clientSource = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../app/components/workbench/WorkbenchInteractiveTerminal.tsx",
  ),
  "utf8",
);
const routeSource = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../app/api/workbench/terminal/sessions/[sessionId]/events/route.ts",
  ),
  "utf8",
);

describe("Workbench terminal SSE lifecycle contract", () => {
  it("rotates before the 300s platform timeout and cleans every server timer", () => {
    expect(routeSource).toMatch(/maxDuration\s*=\s*300/);
    expect(serverSource).toMatch(
      /WORKBENCH_TERMINAL_SSE_ROTATE_MS\s*=\s*255_000/,
    );
    expect(serverSource).toMatch(
      /flush\(\);\s*emit\(\{ type: "rotate", cursor \}\);\s*finish\(\)/,
    );
    expect(serverSource).toContain("clearInterval(heartbeat)");
    expect(serverSource).toContain("clearTimeout(rotation)");
  });

  it("treats rotation as a clean immediate cursor reconnect, not an error retry", () => {
    const rotateEvent = clientSource.indexOf('event.type === "rotate"');
    const cleanReconnect = clientSource.indexOf("if (rotateRequested)");
    const disconnectError = clientSource.indexOf(
      '"The terminal stream disconnected."',
      cleanReconnect,
    );

    expect(rotateEvent).toBeGreaterThan(-1);
    expect(cleanReconnect).toBeGreaterThan(rotateEvent);
    expect(disconnectError).toBeGreaterThan(cleanReconnect);
    expect(clientSource.slice(cleanReconnect, disconnectError)).toContain(
      "continue",
    );
    expect(clientSource).toContain("cursor = event.cursor");
  });
});
