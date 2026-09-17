// Isolated WebKit fixture: production header, menu and CSS; no account or execution APIs.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { webkit } = require("playwright");
const root = path.resolve(__dirname, "..");
const store = path.join(root, "node_modules/.pnpm");
const installed = fs
  .readdirSync(store)
  .find((name) => name.startsWith("esbuild@"));
const esbuild = require(path.join(store, installed, "node_modules/esbuild"));
const source = fs.readFileSync(
  path.join(root, "app/components/HackerMode.tsx"),
  "utf8",
);
const workbenchCss = [
  "CSS",
  "CURSOR_OVERRIDES",
  "REFERENCE_OVERRIDES",
  "PRODUCT_TYPOGRAPHY",
  "WORKBENCH_REFINEMENT",
]
  .map((name) => source.split("const " + name + " = `")[1].split("`;")[0])
  .join("\n");

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rift-hack-navigation-"));
  let browser;
  try {
    await esbuild.build({
      stdin: {
        contents: `import React from 'react';import {createRoot} from 'react-dom/client';
          import {HackWorkbenchHeader} from './app/components/hack/HackWorkbenchHeader';
          window.actions={fresh:0,previous:0,run:0,stop:0};
          createRoot(document.getElementById('root')).render(<div className="fui sidebar-closed">
            <HackWorkbenchHeader target="example.test" onTargetChange={()=>{}} running canRun elapsed="06:09" taskName="Full target recon"
              sidebarOpen={false} onToggleSidebar={()=>{}} onNewAssessment={()=>window.actions.fresh++}
              onPreviousAssessment={()=>window.actions.previous++} onRun={()=>window.actions.run++} onStop={()=>window.actions.stop++}/>
            <main className="term">Assessment content</main></div>);`,
        resolveDir: root,
        loader: "tsx",
      },
      outfile: path.join(temp, "app.js"),
      bundle: true,
      jsx: "automatic",
      tsconfig: path.join(root, "tsconfig.json"),
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [
        {
          name: "navigation-only",
          setup(build) {
            build.onResolve(
              { filter: /^next\/link$|^@\/lib\/utils$/ },
              ({ path }) => ({ path, namespace: "fixture" }),
            );
            build.onLoad(
              { filter: /.*/, namespace: "fixture" },
              ({ path }) => ({
                loader: "tsx",
                resolveDir: root,
                contents:
                  path === "next/link"
                    ? `import React from 'react';export default React.forwardRef(function Link(props,ref){return <a {...props} ref={ref}/>});`
                    : `import {clsx} from 'clsx';import {twMerge} from 'tailwind-merge';export const cn=(...inputs)=>twMerge(clsx(inputs));`,
              }),
            );
          },
        },
      ],
    });
    browser = await webkit.launch();
    const page = await browser.newPage({
      viewport: { width: 1280, height: 844 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}${fs.readFileSync(path.join(root, "app/styles/typography.css"), "utf8")}
      ${workbenchCss}\n${fs.readFileSync(path.join(temp, "app.css"), "utf8")}</style><div id="root"></div>`);
    await page.addScriptTag({ path: path.join(temp, "app.js") });
    const results = [];
    for (const width of [320, 360, 390, 600, 601, 700, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const fresh = page.getByRole("button", { name: "New assessment" });
      const history = page.getByRole("button", { name: "Assessment history" });
      await fresh.click();
      await history.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("menuitem", { name: "Previous assessment" }).click();
      const result = await page.evaluate(() => {
        const controls = [
          ...document
            .querySelector('[data-testid="hack-titlebar"]')
            .querySelectorAll("a,button,h1"),
        ].map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            name: el.getAttribute("aria-label") || el.textContent,
            left: rect.left,
            right: rect.right,
            width: rect.width,
          };
        });
        return {
          viewport: innerWidth,
          overflow: document.documentElement.scrollWidth - innerWidth,
          controls,
          actions: window.actions,
        };
      });
      assert.equal(result.overflow, 0, `No horizontal overflow at ${width}`);
      for (const [index, control] of result.controls.entries()) {
        assert(
          control.left >= 0 && control.right <= width,
          `${control.name} inside ${width}px viewport`,
        );
        if (index)
          assert(
            control.left >= result.controls[index - 1].right,
            `No control collision at ${width}`,
          );
      }
      assert.equal(result.actions.run, 0);
      assert.equal(result.actions.stop, 0);
      results.push(result);
    }
    assert.equal(results.at(-1).actions.fresh, results.length);
    assert.equal(results.at(-1).actions.previous, results.length);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ engine: "webkit", results, errors }));
  } finally {
    await browser?.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
