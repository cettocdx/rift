const fs = require("node:fs/promises");
const path = require("node:path");

// Synthetic fixture only. No screenshots, network bodies or memory dumps.
const TRACE_CATEGORIES = [
  "devtools.timeline",
  "blink.user_timing",
  "disabled-by-default-devtools.timeline",
];

async function startBrowserTrace(session, destination, options = {}) {
  // JSON serialization expands the native trace buffer. Bound disk export
  // separately while retaining the 64MiB browser buffer below.
  const maxBytes = options.maxBytes ?? 256 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 25_000;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    throw new Error("Invalid trace bounds");
  }
  const { categories } = await session.send("Tracing.getCategories");
  const missing = TRACE_CATEGORIES.filter(
    (category) => !categories.includes(category),
  );
  if (missing.length)
    throw new Error(`Trace categories unavailable: ${missing.join(", ")}`);
  await session.send("Tracing.start", {
    transferMode: "ReturnAsStream",
    streamFormat: "json",
    traceConfig: {
      recordMode: "recordUntilFull",
      traceBufferSizeInKb: 65536,
      includedCategories: TRACE_CATEGORIES,
    },
  });
  let stopped;
  return {
    stop() {
      stopped ??= collect();
      return stopped;
    },
  };

  async function collect() {
    let timer;
    let listener;
    const complete = new Promise((resolve, reject) => {
      listener = resolve;
      session.once("Tracing.tracingComplete", listener);
      timer = setTimeout(
        () => reject(new Error("Trace completion timed out")),
        timeoutMs,
      );
    });
    let completion;
    try {
      // Observe both promises immediately, including a rejected end command.
      [, completion] = await Promise.all([
        session.send("Tracing.end"),
        complete,
      ]);
    } finally {
      clearTimeout(timer);
      session.removeListener("Tracing.tracingComplete", listener);
    }
    if (!completion.stream)
      throw new Error("Trace completion did not return a stream");
    const partial = `${destination}.partial`;
    let file;
    let ownsPartial = false;
    let bytes = 0;
    try {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      file = await fs.open(partial, "wx");
      ownsPartial = true;
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("Trace stream timed out");
        let readTimer;
        let chunk;
        try {
          chunk = await Promise.race([
            session.send("IO.read", {
              handle: completion.stream,
              size: 512 * 1024,
            }),
            new Promise((_, reject) => {
              readTimer = setTimeout(
                () => reject(new Error("Trace stream timed out")),
                remaining,
              );
            }),
          ]);
        } finally {
          clearTimeout(readTimer);
        }
        const data = Buffer.from(
          chunk.data,
          chunk.base64Encoded ? "base64" : "utf8",
        );
        bytes += data.length;
        if (bytes > maxBytes) throw new Error("Trace byte limit exceeded");
        await file.writeFile(data);
        if (chunk.eof) break;
      }
      await file.close();
      file = undefined;
      await fs.rename(partial, destination);
      return {
        bytes,
        maxBytes,
        categories: TRACE_CATEGORIES,
        dataLossOccurred: completion.dataLossOccurred,
      };
    } finally {
      try {
        if (file) await file.close();
      } finally {
        try {
          if (ownsPartial) await fs.rm(partial, { force: true });
        } finally {
          await session.send("IO.close", { handle: completion.stream });
        }
      }
    }
  }
}

module.exports = { startBrowserTrace, TRACE_CATEGORIES };
