/*
 * Run from the repository root:
 *   node scripts/verify-stream-fluidity.cjs optimized mixed
 *   node scripts/verify-stream-fluidity.cjs legacy mixed
 *   node scripts/verify-stream-fluidity.cjs optimized mixed 2400  # sustained replay
 *   RIFT_PERF_SCROLL=chat RIFT_PERF_ENGINE=webkit node scripts/verify-stream-fluidity.cjs optimized mixed 2400
 *   RIFT_PERF_HISTORY=escaped node scripts/verify-stream-fluidity.cjs optimized mixed 2400 # pathological legacy text
 *   node scripts/verify-stream-fluidity.cjs optimized code 600
 *   node scripts/verify-stream-fluidity.cjs unbounded-code code 600
 *   RIFT_PERF_ENGINE=webkit RIFT_PERF_TIMELINE=/tmp/replay-timeline.json node scripts/verify-stream-fluidity.cjs optimized mixed 600
 *   RIFT_PERF_ENGINE=webkit RIFT_PERF_UNCONTAINED_DETAILS=1 node scripts/verify-stream-fluidity.cjs optimized mixed 600
 *   RIFT_PERF_SCROLL=chat RIFT_PERF_PROFILE=/tmp/replay.cpuprofile RIFT_PERF_TRACE=/tmp/replay-trace.json node scripts/verify-stream-fluidity.cjs optimized mixed 2400
 *
 * "legacy" reproduces the old per-delta link renderer identity in the bundle
 * only; it never changes application source. This is a component stress replay,
 * not an end-to-end model/worker benchmark or a competitor performance claim.
 * scroll=chat uses the production useMessageScroll hook in an overflow surface;
 * the default document mode is retained for comparison with earlier replays.
 * TRACE adds a bounded Chromium rendering trace and requires PROFILE for clock
 * validation. It is diagnostic instrumentation, not an acceptance benchmark.
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { alignClock, summarizeWindow, validateMarkers } = require("./performance/profile-clock.cjs");
const { startBrowserTrace } = require("./performance/browser-trace.cjs");
const root = path.resolve(__dirname, "..");
const requireRoot = createRequire(path.join(root, "package.json"));
// esbuild is already a transitive dependency in this pnpm workspace.
function loadEsbuild() {
  try {
    return requireRoot("esbuild");
  } catch {
    const store = path.join(root, "node_modules/.pnpm");
    const installed = fs
      .readdirSync(store)
      .filter((name) => /^esbuild@/.test(name))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
    assert(
      installed,
      "Install the workspace dependencies before running the replay",
    );
    return require(path.join(store, installed, "node_modules/esbuild"));
  }
}
const esbuild = loadEsbuild();
const tailwindPath = requireRoot.resolve("@tailwindcss/postcss");
const postcss = createRequire(tailwindPath)("postcss");
const tailwind = requireRoot("@tailwindcss/postcss");
const { chromium, webkit } = requireRoot("playwright");
const engine = process.env.RIFT_PERF_ENGINE || "chromium";
assert(["chromium", "webkit"].includes(engine));
const mode = process.argv[2] || "optimized";
const scenario = process.argv[3] || "mixed";
const updates = Number(process.argv[4] || 120);
const timelinePath = process.env.RIFT_PERF_TIMELINE;
const tracePath = process.env.RIFT_PERF_TRACE;
assert(!tracePath || (engine === "chromium" && process.env.RIFT_PERF_PROFILE),
  "RIFT_PERF_TRACE requires Chromium and RIFT_PERF_PROFILE for clock validation");
const historyFormat = process.env.RIFT_PERF_HISTORY || "representative";
assert(["representative", "escaped"].includes(historyFormat));
const scrollMode = process.env.RIFT_PERF_SCROLL || "document";
assert(["document", "chat"].includes(scrollMode));
const detailLayout = process.env.RIFT_PERF_UNCONTAINED_DETAILS ? "uncontained" : "contained";
assert(Number.isInteger(updates) && updates >= 120 && updates <= 2400);
assert(["optimized", "legacy", "unbounded-code"].includes(mode));
assert(["markdown", "mixed", "code"].includes(scenario));
assert(mode !== "unbounded-code" || scenario === "code");

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rift-stream-replay-"));
  let server;
  let browser;
  try {
    await esbuild.build({
      entryPoints: [path.join(root, "scripts/performance/stream-fixture.tsx")],
      bundle: true,
      sourcemap: process.env.RIFT_PERF_PROFILE ? "external" : false,
      jsx: "automatic",
      platform: "browser",
      outfile: path.join(temp, "app.js"),
      tsconfig: path.join(root, "tsconfig.json"),
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [
        {
          name: "isolate-services",
          setup(build) {
            build.onLoad({ filter: /contexts\/GlobalState\.tsx$/ }, () => ({
              contents:
                "export const useGlobalState=()=>({openSidebar:()=>{}});",
              loader: "js",
            }));
            build.onLoad({ filter: /hooks\/useTauri\.tsx?$/ }, () => ({
              contents:
                "export const isTauriEnvironment=()=>false;export const revealFileInDir=()=>{};export const saveFileToLocal=async()=>false;",
              loader: "js",
            }));
            // Reproduce the previous large-code behavior only in this isolated
            // bundle, without modifying application source or a running app.
            if (mode === "unbounded-code")
              build.onLoad(
                { filter: /CodeHighlight\.tsx$/ },
                ({ path: source }) => {
                  const contents = fs.readFileSync(source, "utf8");
                  const budget = " || exceedsHighlightBudget(codeContent)";
                  assert(
                    contents.includes(budget),
                    "Update the code-budget reproduction after renderer changes",
                  );
                  return {
                    contents: contents.replace(budget, ""),
                    loader: "tsx",
                  };
                },
              );
            if (mode === "legacy")
              build.onLoad(
                { filter: /MemoizedMarkdown\.tsx$/ },
                ({ path: source }) => {
                  const contents = fs.readFileSync(source, "utf8");
                  assert(
                    contents.includes("components={MARKDOWN_COMPONENTS}"),
                    "Update the legacy reproduction after renderer changes",
                  );
                  return {
                    contents: contents.replace(
                      "components={MARKDOWN_COMPONENTS}",
                      "components={{...MARKDOWN_COMPONENTS, a: (props) => <MarkdownLink {...props} />}}",
                    ),
                    loader: "tsx",
                  };
                },
              );
          },
        },
      ],
    });
    // Compile real action classes, including named group-hover/focus variants.
    const css = await postcss([tailwind({ base: root })]).process(
      '@import "tailwindcss" source(none);\n@source "../app/components/MessageActions.tsx";\n@source "../components/ui/button.tsx";',
      { from: path.join(root, "scripts/replay.css") },
    );
    // Exercise the production rule, with an explicit isolated reproduction of
    // the previous eager detail layout for before/after comparisons.
    const detailRule = fs.readFileSync(path.join(root, "app/styles/typography.css"), "utf8")
      .match(/\.rift-work-details\s*>\s*\*\s*\{[^}]*\}/)?.[0];
    assert(detailRule, "Update the replay after changing the detail containment selector");
    const styles = `${css.css}
      *{box-sizing:border-box}body{margin:0;font:13px system-ui;background:#161616;color:#eee}
      nav{position:fixed;top:0;background:#222;padding:12px;z-index:2;width:100%;display:flex;gap:12px}
      input{width:400px;padding:8px}nav button{padding:8px}main{padding:60px 24px;transition:width 220ms ease}
      aside{position:fixed;right:0;top:60px;width:40%;height:100vh;background:#222}
      a{color:#a9c8ff}h3{font-size:16px;margin:12px 0}p{margin:10px 0}
      .history-row{content-visibility:auto;contain-intrinsic-size:auto 140px;margin:20px 0}
      .tool-output{max-height:240px;overflow:auto;padding:12px;background:#222;margin:6px 0}
      ${detailLayout === "contained" ? detailRule : ""}
      .rift-work-summary{display:flex;align-items:center;gap:8px;padding:8px}
      svg{width:16px;height:16px}#actions-fixture{padding:16px;border:1px solid #444}
      ${scrollMode === "chat" ? "body{overflow:hidden}main{padding:60px 0 0}#chat-scroll{height:calc(100vh - 60px);overflow:auto;overscroll-behavior:contain;padding:0 24px}" : ""}
    `;
    server = http.createServer((req, res) => {
      res.setHeader(
        "Content-Type",
        req.url === "/app.js" ? "text/javascript" : "text/html",
      );
      res.end(
        req.url === "/app.js"
          ? fs.readFileSync(path.join(temp, "app.js"))
          : `<html><style>${styles}</style><div id="root"></div><script src="/app.js"></script></html>`,
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    browser = await ({ chromium, webkit }[engine]).launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1200, height: 800 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    if (process.env.RIFT_PERF_OBSERVERS) await page.addInitScript(() => {
      const NativeObserver = window.ResizeObserver;
      window.observerHistory = [];
      window.observerErrors = [];
      window.ResizeObserver = class extends NativeObserver {
        constructor(callback) {
          super((entries, observer) => {
            const record = {
              at: performance.now(),
              entries: entries.map((entry) => ({
                target: entry.target.id || entry.target.tagName,
                width: entry.contentRect.width,
                height: entry.contentRect.height,
                beforeHeight: entry.target.getBoundingClientRect().height,
              })),
            };
            window.observerHistory.push(record);
            if (window.observerHistory.length > 20) window.observerHistory.shift();
            callback(entries, observer);
            record.after = entries.map((entry) => ({ target: entry.target.id || entry.target.tagName, height: entry.target.getBoundingClientRect().height }));
          });
        }
      };
      window.addEventListener("error", (event) => {
        window.observerErrors.push({ message: event.message, at: performance.now(), deliveries: [...window.observerHistory] });
      });
    });
    // Correlate frame intervals with commits, DOM changes, and interactions.
    // Pointer diagnostics read control geometry to detect stale painted hit
    // targets. Keep these runs separate from uninstrumented acceptance timings.
    if (timelinePath) await page.addInitScript(() => {
      window.replayTimeline = [];
      window.recordReplayTiming = (entry) => {
        if (window.replayStartedAt) window.replayTimeline.push(entry);
      };
      for (const type of ["input", "pointerdown", "pointerup", "mousedown", "mouseup", "focusin", "click", "wheel", "scroll", "transitionstart", "transitionend"]) {
        document.addEventListener(type, (event) => {
          const target = event.target;
          window.recordReplayTiming({
            kind: type,
            startTime: performance.now(),
            target: target instanceof Element
              ? target.getAttribute("aria-label") || target.id || target.tagName
              : "document",
            ...(["pointerdown", "pointerup", "mousedown", "mouseup", "focusin", "click"].includes(type) && target instanceof Element
              ? { button: target.closest("button")?.textContent,
                  expanded: target.closest("button")?.getAttribute("aria-expanded"),
                  targetHtml: target.outerHTML.slice(0, 300),
                  x: event.clientX, y: event.clientY,
                  scrollTop: document.querySelector("#chat-scroll")?.scrollTop,
                  controlRect: document.querySelector("#live button[aria-expanded]")?.getBoundingClientRect().toJSON() }
              : {}),
            ...(event instanceof TransitionEvent ? { property: event.propertyName } : {}),
          });
        }, { capture: true, passive: true });
      }
      new MutationObserver((records) => {
        window.recordReplayTiming({
          kind: "dom-mutation",
          startTime: performance.now(),
          records: records.length,
          characterData: records.filter((record) => record.type === "characterData").length,
          added: records.reduce((count, record) => count + record.addedNodes.length, 0),
          removed: records.reduce((count, record) => count + record.removedNodes.length, 0),
        });
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    // Diagnostic only: timings include instrumentation overhead. Never use
    // these runs as acceptance measurements.
    if (process.env.RIFT_PERF_REGEX) await page.addInitScript(() => {
      const original = RegExp.prototype.exec;
      const timings = new Map();
      window.regexTimings = timings;
      RegExp.prototype.exec = function (value) {
        const start = performance.now();
        const result = original.call(this, value);
        const elapsed = performance.now() - start;
        if (elapsed >= 1) {
          const key = String(this);
          const record = timings.get(key) || { pattern: key, total: 0, count: 0, max: 0 };
          record.total += elapsed;
          record.count++;
          record.max = Math.max(record.max, elapsed);
          timings.set(key, record);
        }
        return result;
      };
    });
    // This fixture must never call a provider or the user's running app.
    await page.route("**/*", (route) =>
      route
        .request()
        .url()
        .startsWith(`http://127.0.0.1:${server.address().port}/`)
        ? route.continue()
        : route.abort(),
    );
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?scenario=${scenario}&updates=${updates}&scroll=${scrollMode}&history=${historyFormat}`,
    );
    await page.waitForFunction(() => typeof window.startReplay === "function");
    const actions = page.locator(
      '#actions-fixture > [class~="group/message-actions"]',
    );
    await page.mouse.move(1190, 790);
    await page.waitForTimeout(200);
    assert.equal(
      await actions.evaluate((el) => getComputedStyle(el).opacity),
      "0",
    );
    await page.locator("#actions-fixture p").hover();
    await page.waitForTimeout(200);
    assert.equal(
      await actions.evaluate((el) => getComputedStyle(el).opacity),
      "1",
    );
    await page.mouse.move(1190, 790);
    await page
      .getByRole("button", { name: "Edit message", exact: true })
      .focus();
    await page.waitForTimeout(200);
    assert.equal(
      await actions.evaluate((el) => getComputedStyle(el).opacity),
      "1",
    );
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#edit-confirmed").count(), 1);
    await page
      .locator("#live")
      .evaluate((el) => {
        const surface = document.querySelector("#chat-scroll");
        if (surface) {
          surface.scrollTop += el.getBoundingClientRect().top - surface.getBoundingClientRect().top;
        } else window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 100);
      });
    await page.waitForTimeout(600);
    if (scrollMode === "chat") {
      await page.locator("#chat-scroll").evaluate((surface) => {
        window.chatScrollEvents = 0;
        surface.addEventListener("scroll", () => { window.chatScrollEvents++; }, { passive: true });
      });
    }
    const fixtureShape = await page.evaluate(() => ({
      historyRows: document.querySelectorAll(".history-row").length,
      historyHeadings: document.querySelectorAll(".history-row h3").length,
      liveHeadings: document.querySelectorAll("#live h3").length,
      liveTables: document.querySelectorAll("#live table").length,
      liveCodeBlocks: document.querySelectorAll("#live pre").length,
    }));
    if (historyFormat === "representative") {
      assert.equal(fixtureShape.historyHeadings, 200, "History must render real Markdown headings");
      assert.equal(fixtureShape.liveHeadings, 180, "Mixed transcript must retain real historical sections");
      assert.equal(fixtureShape.liveTables, 15, "Mixed transcript must render tables");
      if (scenario !== "markdown") assert.equal(fixtureShape.liveCodeBlocks, 18, "Mixed transcript must render historical code fences");
    }
    const profiler = process.env.RIFT_PERF_PROFILE && engine === "chromium"
      ? await page.context().newCDPSession(page) : null;
    const browserTrace = tracePath ? await startBrowserTrace(profiler, tracePath) : null;
    const clockAnchors = [];
    const clockMarkers = [];
    const captureClock = async (phase) => {
      // Timestamp is sampled between the two awaited page readings, so the
      // offset interval explicitly contains CDP/renderer round-trip latency.
      for (let index = 0; index < 3; index++) {
        const before = await page.evaluate(() => ({ now: performance.now(), timeOrigin: performance.timeOrigin }));
        const { metrics } = await profiler.send("Performance.getMetrics");
        const after = await page.evaluate(() => performance.now());
        const values = Object.fromEntries(metrics.map(metric => [metric.name, metric.value]));
        assert(Number.isFinite(values.Timestamp), "CDP monotonic timestamp unavailable");
        clockAnchors.push({phase,index,pageBeforeMs:before.now,pageAfterMs:after,pageTimeOriginMs:before.timeOrigin,timestampSeconds:values.Timestamp,navigationStartSeconds:values.NavigationStart});
      }
    };
    const recordClockMarker = async (phase) => {
      clockMarkers.push(await page.evaluate((phase) => {
        // Outside measured replay; retained in CPU profile and page clock to
        // independently validate the monotonic-clock mapping on this browser.
        function riftProfileClockMarker() {
          const until = performance.now() + 30;
          while (performance.now() < until) Math.sqrt(performance.now());
        }
        const startTime = performance.now();
        performance.mark(`rift-cpu-clock-${phase}-start`);
        riftProfileClockMarker();
        const endTime = performance.now();
        performance.mark(`rift-cpu-clock-${phase}-end`);
        return {phase,startTime,endTime};
      }, phase));
    };
    if (profiler) {
      await profiler.send("Performance.enable", { timeDomain: "timeTicks" });
      await profiler.send("Profiler.enable");
      await profiler.send("Profiler.start");
      await captureClock("before-replay");
      await recordClockMarker("before-replay");
      // Let marker work/LoAF delivery settle before starting measurement.
      await page.waitForTimeout(100);
    }
    await page.evaluate(() => {
      const m = (window.metrics = { frames: [], tasks: [], taskEntries: [], taskEntriesDropped: 0, events: [], longFrames: [] });
      let last = 0;
      const tick = (t) => {
        if (last) {
          m.frames.push(t - last);
          if (t - last > 50) window.recordReplayTiming?.({ kind: "slow-frame", startTime: last, duration: t - last });
        }
        last = t;
        window.raf = requestAnimationFrame(tick);
      };
      window.raf = requestAnimationFrame(tick);
      window.po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          m.tasks.push(entry.duration);
          // Keep numeric page-clock data only, bounded independently of aggregate
          // count/max. Long Tasks and LoAF script windows are not interchangeable.
          m.taskEntries.push({ startTime: entry.startTime, duration: entry.duration });
          if (m.taskEntries.length > 1000) {
            m.taskEntries.shift();
            m.taskEntriesDropped++;
          }
        }
      });
      if (PerformanceObserver.supportedEntryTypes.includes("longtask"))
        window.po.observe({ type: "longtask" });
      window.eo = new PerformanceObserver((list) =>
        m.events.push(
          ...list
            .getEntries()
            .filter((e) => e.interactionId)
            .map((e) => e.duration),
        ),
      );
      if (PerformanceObserver.supportedEntryTypes.includes("event"))
        window.eo.observe({ type: "event", durationThreshold: 16 });
      window.lo = new PerformanceObserver((list) => {
        m.longFrames.push(...list.getEntries().map((e) => ({
          startTime: e.startTime,
          duration: e.duration, blockingDuration: e.blockingDuration,
          renderStart: e.renderStart,
          styleAndLayoutStart: e.styleAndLayoutStart,
          scripts: e.scripts?.map((s) => ({
            invoker: s.invoker,
            startTime: s.startTime,
            duration: s.duration,
            executionStart: s.executionStart,
            sourceFunctionName: s.sourceFunctionName,
            sourceCharPosition: s.sourceCharPosition,
            forcedLayoutMs: s.forcedStyleAndLayoutDuration,
          }))
        })));
      });
      if (PerformanceObserver.supportedEntryTypes.includes("long-animation-frame"))
        window.lo.observe({type: "long-animation-frame"});
      window.savedLink = document.querySelector("#live a");
      window.replayComplete = false;
      window.replayStartedAt = performance.now();
      window.replayDone = window.startReplay().then(() => {
        window.replayComplete = true;
      });
    });
    let draft =
      "Typing while a long agent answer is streaming. No missing characters.";
    await page
      .getByRole("textbox", { name: "Draft" })
      .pressSequentially(draft, { delay: 24 });
    for (let i = 0; i < 6; i++) {
      await page.getByRole("button", { name: "Toggle panel" }).click();
      await page.mouse.move(350, 400);
      await page.mouse.wheel(0, i % 2 ? -250 : 250);
      await page.waitForTimeout(60);
    }
    let sustainedInteractions = 0;
    let disclosureToggles = 0;
    if (updates > 120) {
      const group = page.locator("#live button[aria-expanded]").first();
      while (!(await page.evaluate(() => window.replayComplete))) {
        // Explicitly append after refocusing; macOS End is a document-scroll
        // shortcut, and locator typing may reset selection when focus changes.
        await page.getByRole("textbox", { name: "Draft" }).evaluate((input) => {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        });
        await page.keyboard.type(".", { delay: 24 });
        draft += ".";
        await page.getByRole("button", { name: "Toggle panel" }).click();
        await page.mouse.move(350, 400);
        await page.mouse.wheel(0, sustainedInteractions % 2 ? -250 : 250);
        if ((scenario === "mixed" || scenario === "code") && sustainedInteractions < 2) {
          // Wheel scrolling, width transitions and content-visibility can move
          // this target while a pointer click is being dispatched. Settle it
          // and verify the actual state change, not merely click delivery.
          await group.scrollIntoViewIfNeeded();
          await page.waitForTimeout(250);
          const wasOpen = await group.getAttribute("aria-expanded") === "true";
          await group.click();
          await page.waitForFunction((open) => document.querySelector('#live button[aria-expanded]')?.getAttribute('aria-expanded') === String(open), !wasOpen, { timeout: 5000 }).catch(async error => {
            await page.screenshot({ path: '/tmp/rift-stream-interaction-failure.png' });
            const evidence = await page.evaluate((expectedOpen) => ({
              expectedOpen,
              button: document.querySelector('#live button[aria-expanded]')?.outerHTML,
              events: window.replayTimeline?.slice(-1000),
            }), !wasOpen);
            fs.writeFileSync('/tmp/rift-stream-interaction-failure.json', JSON.stringify(evidence));
            throw error;
          });
          disclosureToggles++;
        }
        sustainedInteractions++;
        await page.waitForTimeout(1400);
      }
    }
    await page.evaluate(() => window.replayDone);
    await page.waitForTimeout(150);
    const result = await page.evaluate(
      ({ updates, scenario }) => {
        cancelAnimationFrame(window.raf);
        window.po.disconnect();
        window.eo.disconnect();
        window.lo.disconnect();
        const percentile = (values, q) =>
          values.length
            ? values.toSorted((a, b) => a - b)[
                Math.min(values.length - 1, Math.floor(values.length * q))
              ]
            : null;
        return {
          ...(window.observerErrors ? { observerErrors: window.observerErrors } : {}),
          chatScrollEvents: window.chatScrollEvents ?? null,
          ...(window.regexTimings ? { diagnosticRegex: [...window.regexTimings.values()].sort((a, b) => b.total - a.total).slice(0, 15) } : {}),
          measuredDurationMs: Math.round(
            performance.now() - window.replayStartedAt,
          ),
          longAnimationFrames: window.metrics.longFrames.slice(-30),
          frameP95: percentile(window.metrics.frames, 0.95),
          frameMax: Math.max(...window.metrics.frames),
          longTasks: PerformanceObserver.supportedEntryTypes.includes("longtask") ? window.metrics.tasks.length : null,
          longTaskEntries: PerformanceObserver.supportedEntryTypes.includes("longtask") ? window.metrics.taskEntries : null,
          longTaskEntriesDropped: PerformanceObserver.supportedEntryTypes.includes("longtask") ? window.metrics.taskEntriesDropped : null,
          longTaskMax: PerformanceObserver.supportedEntryTypes.includes("longtask") ? Math.max(0, ...window.metrics.tasks) : null,
          supportedMetrics: PerformanceObserver.supportedEntryTypes,
          frameP99: percentile(window.metrics.frames, 0.99),
          framesOver50Ms: window.metrics.frames.filter((v) => v > 50).length,
          framesOver100Ms: window.metrics.frames.filter((v) => v > 100).length,
          heapBytes: performance.memory?.usedJSHeapSize ?? null,
          eventP95: percentile(window.metrics.events, 0.95),
          eventSamples: window.metrics.events.length,
          frameSamples: window.metrics.frames.length,
          originalLinkRetained:
            window.savedLink === document.querySelector("#live a"),
          draft: document.querySelector("input").value,
          finalTextPresent: document
            .querySelector("#live")
            .textContent.includes(
              scenario === "code"
                ? "Streaming output."
                : "Streaming output. ".repeat(updates).trim(),
            ),
          codeTextPresent:
            scenario !== "code" ||
            document
              .querySelector("#live")
              .textContent.includes(`export const item${updates * 3 - 1} =`),
          liveDomNodes: document.querySelectorAll("#live *").length,
          historyRows: document.querySelectorAll(".history-row").length,
        };
      },
      { updates, scenario },
    );
    assert.equal(result.draft, draft);
    assert(result.originalLinkRetained);
    assert(result.finalTextPresent);
    assert(result.codeTextPresent);
    if (scrollMode === "chat") assert(result.chatScrollEvents > 0, "The real chat surface must receive scroll events");
    if (process.env.RIFT_PERF_RESULT) fs.writeFileSync(process.env.RIFT_PERF_RESULT, JSON.stringify({ engine, mode, scenario, updates, historyFormat, fixtureShape, ...result, errors }));
    assert.deepEqual(errors, []);
    if (timelinePath) {
      const timeline = await page.evaluate(() => {
        const entries = window.replayTimeline;
        return {
          startedAt: window.replayStartedAt,
          slowFrames: entries.filter((entry) => entry.kind === "slow-frame").map((frame) => ({
            ...frame,
            nearby: entries.filter((entry) => entry.kind !== "slow-frame" &&
              entry.startTime + (entry.duration || 0) >= frame.startTime - 25 &&
              entry.startTime <= frame.startTime + frame.duration + 5),
          })),
          entries,
        };
      });
      fs.writeFileSync(timelinePath, JSON.stringify({ engine, mode, scenario, updates, historyFormat, fixtureShape, detailLayout, diagnostic: true, result, ...timeline }, null, 2));
    }
    if (process.env.RIFT_PERF_REGEX) fs.writeFileSync(process.env.RIFT_PERF_REGEX, JSON.stringify(result.diagnosticRegex));
    // Validate actual disclosure controls and bounded synthetic outputs too.
    if (scenario === "mixed" || scenario === "code") {
      const group = page.locator("#live button[aria-expanded]").first();
      await group.evaluate(el => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(250);
      // Sustained replay may already have opened the group; do not toggle it
      // closed and then wait forever for an open state.
      if (await group.getAttribute("aria-expanded") !== "true") await group.click();
      await page.waitForFunction(() => document.querySelector('#live button[aria-expanded]')?.getAttribute('aria-expanded') === 'true', null, { timeout: 5000 }).catch(async error => {
        await page.screenshot({ path: '/tmp/rift-disclosure-failure.png' });
        console.error(await group.evaluate(el => ({ html: el.outerHTML, rect: el.getBoundingClientRect().toJSON(), focus: document.activeElement?.outerHTML })));
        throw error;
      });
      assert.equal(await group.getAttribute("aria-expanded"), "true");
      assert.equal(await page.locator(".tool-output").count(), 120);
      // Containment must not truncate or make later evidence inaccessible.
      // These layout checks run after the timing collection has ended.
      const lastOutput = page.locator(".tool-output").last();
      await lastOutput.scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise(requestAnimationFrame));
      assert(await lastOutput.evaluate(el => el.checkVisibility({contentVisibilityAuto: true})));
      assert((await lastOutput.textContent()).includes("Check 59: passed"));
      await group.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await group.click();
      await page.waitForFunction(() => document.querySelectorAll('.tool-output').length === 0);
      assert.equal(await page.locator(".tool-output").count(), 0);
    }
    if (profiler) {
      await recordClockMarker("after-replay");
      await captureClock("after-replay");
      const { profile } = await profiler.send("Profiler.stop");
      const alignment = alignClock(clockAnchors);
      const markerValidation = alignment.valid ? validateMarkers(profile, alignment, clockMarkers) : [];
      const validated = alignment.valid && markerValidation.length === 2 && markerValidation.every(marker => marker.validated);
      const correlation = {
        diagnostic: true,
        engine, mode, scenario, updates, historyFormat, fixtureShape,
        alignment,
        anchors: clockAnchors,
        markers: markerValidation,
        validated,
        note: "CPU samples are statistical stack observations, not exact function durations. Page/CPU alignment uncertainty brackets command latency; browser timestamp quantization, sampling interval, and profiling overhead remain separate. Markers run outside replay measurement.",
        longFrames: validated ? result.longAnimationFrames.map(frame => ({...frame,cpu:summarizeWindow(profile,alignment,frame.startTime,frame.duration),scripts:frame.scripts?.map(script=>({...script,cpu:summarizeWindow(profile,alignment,script.startTime,script.duration)}))})) : [],
      };
      fs.writeFileSync(process.env.RIFT_PERF_PROFILE, JSON.stringify({ ...profile, riftPageClock: correlation }));
      fs.writeFileSync(process.env.RIFT_PERF_PROFILE + ".correlation.json", JSON.stringify(correlation, null, 2));
      fs.copyFileSync(path.join(temp, "app.js"), process.env.RIFT_PERF_PROFILE + ".js");
      fs.copyFileSync(path.join(temp, "app.js.map"), process.env.RIFT_PERF_PROFILE + ".js.map");
      if (timelinePath) {
        const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf8"));
        timeline.cpuProfileCorrelation = correlation;
        fs.writeFileSync(timelinePath, JSON.stringify(timeline, null, 2));
      }
      if (browserTrace) {
        const traceMetadata = await browserTrace.stop();
        fs.writeFileSync(tracePath + ".meta.json", JSON.stringify({
          ...traceMetadata, engine, browser: browser.version(), correlation,
          diagnostic: true,
        }, null, 2));
        assert.equal(traceMetadata.dataLossOccurred, false,
          "Trace completeness not verified; retain artifacts but do not attribute tasks");
      }
      assert(validated, "CPU/page clock markers did not validate; retain artifacts but do not attribute LoAFs");
      await profiler.detach();
    }
    console.log(
      JSON.stringify({
        engine,
        scrollMode,
        historyFormat,
        fixtureShape,
        mode,
        scenario,
        browser: browser.version(),
        viewport: "1200x800",
        updates,
        detailLayout,
        diagnostic: Boolean(tracePath || timelinePath || process.env.RIFT_PERF_REGEX || process.env.RIFT_PERF_PROFILE || process.env.RIFT_PERF_OBSERVERS),
        sustainedInteractions,
        disclosureToggles,
        hoverAndKeyboardActions: "passed",
        ...result,
      }),
    );
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
