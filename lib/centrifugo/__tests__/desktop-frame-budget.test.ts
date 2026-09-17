/** @jest-environment node */
import { readFileSync } from "node:fs";
import { join } from "node:path";

it("can carry the bounded native screenshot result without closing its WebSocket", () => {
  const config = JSON.parse(
    readFileSync(join(process.cwd(), "docker/centrifugo/config.json"), "utf8"),
  );
  const frame = JSON.stringify({
    id: 1,
    publish: {
      channel: "sandbox:connection:" + "c".repeat(128) + "#" + "u".repeat(128),
      data: {
        type: "desktop_local_access_result",
        requestId: "r".repeat(128),
        ok: true,
        result: {
          mediaType: "image/jpeg",
          image: Buffer.alloc(500 * 1024).toString("base64"),
        },
      },
    },
  });
  expect(Buffer.byteLength(frame)).toBeLessThan(
    config.websocket_message_size_limit ?? 65536,
  );
  expect(config.websocket_message_size_limit).toBeLessThanOrEqual(1024 * 1024);
});
