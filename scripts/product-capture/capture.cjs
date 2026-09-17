/** Offline staged product assets. Never connects to auth, providers or live chats. */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { chromium } = require("@playwright/test");
const root = path.resolve(__dirname, "../..");
const output = path.join(root, "public/landing/product");
const files = {
  build: [
    "build-product-design-4k.webp",
    "build-application-4k.webp",
    "build-reasoning-4k.webp",
  ],
  studio: ["studio-4k.webp"],
  agents: ["agents-4k.webp"],
  appearance: ["appearance-4k.webp"],
  workbench: ["workbench-4k.webp"],
  workspace: ["workspace-4k.webp"],
};
(async () => {
  const bundle = await require("./build.cjs")();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/studio/status") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ready: true, missing: [] }));
      return;
    }
    if (url.pathname === "/capture.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(bundle.js);
      return;
    }
    if (url.pathname === "/capture.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(bundle.css);
      return;
    }
    if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/capture.css"></head><body style="margin:0;height:100vh"><div id="root" style="height:100%"></div><script src="/capture.js"></script></body></html>',
      );
      return;
    }
    const file = path.resolve(
      root,
      "public",
      "." + decodeURIComponent(url.pathname),
    );
    if (
      !file.startsWith(path.join(root, "public") + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const sharp = require(
    path.join(
      root,
      "node_modules/.pnpm",
      fs
        .readdirSync(path.join(root, "node_modules/.pnpm"))
        .find((name) => name.startsWith("sharp@")),
      "node_modules/sharp",
    ),
  );
  const assets = [];
  const temporary = fs.mkdtempSync(
    path.join(require("node:os").tmpdir(), "rift-product-capture-"),
  );
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 3,
      reducedMotion: "reduce",
    });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const [view, names] of Object.entries(files)) {
      errors.length = 0;
      await page.goto(`${origin}/?view=${view}`);
      await page.waitForSelector(
        "[data-product-capture], [data-pro-workbench]",
      );
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1200);
      await page.evaluate(async () => {
        await Promise.all(
          [...document.images].map((image) =>
            image.decode().catch(() => undefined),
          ),
        );
      });
      const branding = await page.evaluate(() => ({
        current: !!document.querySelector(
          'path[d="M55 7C70 16 85 27 91 39Q95 47 81 47H9C40 43 57 37 60 27C62 20 59 12 55 7Z"]',
        ),
        old: !!document.querySelector('path[d^="M85.34"],path[d^="M98.21"]'),
      }));
      if (!branding.current || branding.old)
        throw Error(`${view}: missing new branding or stale geometry`);
      console.log(`Validated offline ${view} scene with canonical branding`);
      if (errors.length) throw Error(`${view}: ${errors.join("; ")}`);
      const png = path.join(temporary, `${view}.png`);
      await page.screenshot({ path: png });
      for (const name of names) {
        await sharp(png).webp({ quality: 92 }).toFile(path.join(output, name));
        assets.push({
          view,
          file: name,
          kind: "staged-demo",
          sha256: crypto
            .createHash("sha256")
            .update(fs.readFileSync(path.join(output, name)))
            .digest("hex"),
        });
      }
    }
    // A labeled scene reel, not a fabricated live execution or provider result.
    const frames = path.join(temporary, "reel.txt");
    fs.writeFileSync(
      frames,
      ["build", "studio", "agents", "workbench", "workspace"]
        .map(
          (view) => `file '${path.join(temporary, view + ".png")}'\nduration 2`,
        )
        .join("\n") + `\nfile '${path.join(temporary, "workspace.png")}'\n`,
    );
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-i",
      path.join(temporary, "build.png"),
      "-frames:v",
      "1",
      path.join(output, "hero-run-poster.jpg"),
    ]);
    for (const [extension, codec] of [
      ["mp4", "libx264"],
      ["webm", "libvpx-vp9"],
    ]) {
      const name = `hero-run-4k.${extension}`;
      execFileSync("ffmpeg", [
        "-y",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        frames,
        "-r",
        "24",
        "-c:v",
        codec,
        ...(extension === "mp4"
          ? [
              "-preset",
              "fast",
              "-crf",
              "20",
              "-pix_fmt",
              "yuv420p",
              "-movflags",
              "+faststart",
            ]
          : [
              "-deadline",
              "realtime",
              "-cpu-used",
              "8",
              "-crf",
              "34",
              "-b:v",
              "0",
            ]),
        path.join(output, name),
      ]);
      assets.push({
        file: name,
        kind: "staged-demo-scene-reel",
        sha256: crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(output, name)))
          .digest("hex"),
      });
    }
    assets.push({
      file: "hero-run-poster.jpg",
      view: "build",
      kind: "staged-demo",
      sha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(output, "hero-run-poster.jpg")))
        .digest("hex"),
    });
    const previous = JSON.parse(
      fs.readFileSync(path.join(output, "manifest.json"), "utf8"),
    );
    const untouched = previous.assets.filter(
      (asset) => !assets.some((next) => next.file === asset.file),
    );
    fs.writeFileSync(
      path.join(output, "manifest.json"),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          captureKind: "offline-staged-demo",
          command: "node scripts/product-capture/capture.cjs",
          captureViewport: {
            cssWidth: 1280,
            cssHeight: 720,
            deviceScaleFactor: 3,
            pixelWidth: 3840,
            pixelHeight: 2160,
          },
          assets: [...assets, ...untouched],
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      `Captured ${assets.length} staged assets; no live execution. Samples: ${temporary}`,
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
