import fs from "fs";
import path from "path";

const routeSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../app/api/chat/[id]/stream/route.ts"),
  "utf8",
);

describe("chat reconnect stream cleanup", () => {
  it("uses removable abort listeners for the initial peek and later chunks", () => {
    expect(routeSrc.match(/readStreamChunkWithAbort\(/g)).toHaveLength(2);
    expect(routeSrc).not.toMatch(
      /const abortPromise\s*=\s*new Promise<never>/,
    );
  });

  it("stops cancellation monitoring on EOF, abort, error, and consumer cancel", () => {
    const cleanupStart = routeSrc.indexOf("const cleanup =");
    const streamStart = routeSrc.indexOf(
      "const abortableStream = new ReadableStream",
      cleanupStart,
    );
    const cleanupBody = routeSrc.slice(cleanupStart, streamStart);

    expect(cleanupBody).toMatch(/await cancellationSubscriber\.stop\(\)/);
    expect(cleanupBody).toMatch(/await reader\.cancel\(\)/);

    const streamBody = routeSrc.slice(streamStart);
    expect(streamBody).toMatch(/if \(done\)\s*{\s*await cleanup\(false\)/s);
    expect(streamBody.match(/await cleanup\(true\)/g)?.length).toBeGreaterThanOrEqual(
      3,
    );
  });
});
