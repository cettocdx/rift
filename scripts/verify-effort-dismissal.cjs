// Real CSS + Radix Presence regression. No provider, account, or application server is contacted.
const fs = require("fs"),
  path = require("path"),
  http = require("http"),
  assert = require("assert/strict");
const root = path.resolve(__dirname, "..");
const req = require("module").createRequire(root + "/package.json");
const store = root + "/node_modules/.pnpm";
const esbuild = require(
  path.join(
    store,
    fs.readdirSync(store).find((n) => n.startsWith("esbuild@")),
    "node_modules/esbuild",
  ),
);
const postcss = require("module").createRequire(
  req.resolve("@tailwindcss/postcss"),
)("postcss");
(async () => {
  const tmp = fs.mkdtempSync("/tmp/rift-effort-");
  let server, browser;
  try {
    await esbuild.build({
      stdin: {
        contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{ReasoningEffortSelector}from'./app/components/ChatInput/ReasoningEffortSelector';function App(){const[v,s]=useState('medium');return <main><ReasoningEffortSelector model="build-codex" value={v} onChange={s}/><input aria-label="Next field"/></main>}createRoot(document.getElementById('root')).render(<App/>);`,
        resolveDir: root,
        loader: "tsx",
      },
      bundle: true,
      jsx: "automatic",
      outfile: tmp + "/app.js",
      tsconfig: root + "/tsconfig.json",
      define: { "process.env.NODE_ENV": '"production"' },
      loader: { ".module.css": "local-css" },
    });
    const css = await postcss([
      req("@tailwindcss/postcss")({ base: root }),
    ]).process(
      '@import "tailwindcss" source(none);@import "tw-animate-css";@source "../components/ui/popover.tsx";',
      { from: root + "/scripts/effort.css" },
    );
    server = http.createServer((r, s) => {
      s.setHeader(
        "Content-Type",
        r.url === "/app.js" ? "text/javascript" : "text/html",
      );
      s.end(
        r.url === "/app.js"
          ? fs.readFileSync(tmp + "/app.js")
          : `<style>${css.css}\n${fs.readFileSync(tmp + "/app.css")}\nbody{background:#171717;color:white;font:13px system-ui}main{padding:300px 400px}button{cursor:pointer}</style><div id="root"></div><script src="/app.js"></script>`,
      );
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    browser = await req("playwright").chromium.launch({ headless: true });
    const p = await browser.newPage();
    await p.goto("http://127.0.0.1:" + server.address().port);
    for (const motion of ["no-preference", "reduce"]) {
      await p.emulateMedia({ reducedMotion: motion });
      for (const method of ["escape", "keyboard-then-escape", "outside"]) {
        await p.getByRole("button", { name: /Reasoning strength/ }).click();
        await p.waitForTimeout(250);
        if (method === "keyboard-then-escape")
          await p.getByRole("slider").press("ArrowRight");
        if (method === "outside") await p.getByRole("textbox").click();
        else await p.getByRole("slider").press("Escape");
        await p.waitForTimeout(350);
        const state = await p
          .locator('[data-ui="reasoning-effort-popover"]')
          .evaluateAll((es) =>
            es.map((e) => ({
              state: e.dataset.state,
              keyboard: e.dataset.keyboard,
              animation: getComputedStyle(e).animationName,
            })),
          );
        console.log(JSON.stringify({ motion, method, remaining: state }));
        assert.equal(
          state.length,
          0,
          `${method}: closed popover remained mounted`,
        );
      }
    }
  } finally {
    await browser?.close();
    server?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
