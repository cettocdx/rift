const assert = require("node:assert/strict");

function phaseFor(name) {
  if (
    /^(?:V8\..*GC|MinorGC|MajorGC|GC\b)|GarbageCollect|Scavenge|MarkCompact/.test(
      name,
    )
  )
    return "gc";
  if (/^(?:UpdateLayoutTree|RecalculateStyles)$/.test(name)) return "style";
  if (/^(?:Layout|LocalFrameView::performLayout)$/.test(name)) return "layout";
  if (/^(?:PrePaint|Paint|PaintImage|RasterTask)$/.test(name)) return "paint";
  if (/^(?:Layerize|CompositeLayers|UpdateLayerTree|Commit)$/.test(name))
    return "compositing";
  if (
    /^(?:FunctionCall|EvaluateScript|EventDispatch|FireAnimationFrame|TimerFire|RunMicrotasks|V8.Execute|v8.run)$/.test(
      name,
    )
  )
    return "javascript";
  return undefined;
}

function validateTraceThread(events, clock, markerToleranceMs = 2) {
  assert(
    clock.validated && clock.alignment?.valid,
    "CPU/page clock is not validated",
  );
  assert(Number.isFinite(clock.alignment.offsetMs), "Missing CPU/page offset");
  assert(
    Number.isFinite(markerToleranceMs) && markerToleranceMs >= 0,
    "Invalid marker tolerance",
  );
  const matched = [];
  for (const phase of ["before-replay", "after-replay"]) {
    const marker = clock.markers.find((m) => m.phase === phase);
    assert(marker?.validated, `Missing validated CPU marker ${phase}`);
    for (const edge of ["start", "end"]) {
      const name = `rift-cpu-clock-${phase}-${edge}`;
      const found = events.filter(
        (e) =>
          e.name === name &&
          String(e.cat).split(",").includes("blink.user_timing"),
      );
      assert.equal(
        found.length,
        1,
        `Missing or ambiguous trace marker ${name}`,
      );
      const e = found[0];
      assert(Number.isFinite(e.ts), `Invalid timestamp for ${name}`);
      const pageMs = e.ts / 1000 - clock.alignment.offsetMs;
      const expectedMs = edge === "start" ? marker.startTime : marker.endTime;
      const residualMs = pageMs - expectedMs;
      assert(
        Math.abs(residualMs) <=
          markerToleranceMs + clock.alignment.uncertaintyMs,
        `Trace/page marker mismatch ${name}`,
      );
      matched.push({
        name,
        pid: e.pid,
        tid: e.tid,
        pageMs,
        expectedMs,
        residualMs,
      });
    }
  }
  const { pid, tid } = matched[0];
  assert(
    Number.isFinite(pid) && Number.isFinite(tid),
    "Invalid marker process/thread IDs",
  );
  assert(
    matched.every((m) => m.pid === pid && m.tid === tid),
    "Markers belong to different threads",
  );
  assert(
    events.some(
      (e) =>
        e.ph === "M" &&
        e.name === "thread_name" &&
        e.pid === pid &&
        e.tid === tid &&
        e.args?.name === "CrRendererMain",
    ),
    "Validated marker thread is not CrRendererMain",
  );
  return {
    pid,
    tid,
    markers: matched,
    markerToleranceMs,
    clockUncertaintyMs: clock.alignment.uncertaintyMs,
  };
}

function synchronousSpans(events, thread) {
  const selected = events
    .filter(
      (e) =>
        e.pid === thread.pid &&
        e.tid === thread.tid &&
        ["X", "B", "E"].includes(e.ph),
    )
    .map((e, index) => ({ ...e, index }))
    .sort((a, b) => a.ts - b.ts || a.index - b.index);
  const stack = [],
    spans = [];
  let unmatchedEnds = 0;
  const push = (e, endUs) => {
    if (Number.isFinite(e.ts) && Number.isFinite(endUs) && endUs > e.ts)
      spans.push({
        name: e.name,
        cat: e.cat,
        startUs: e.ts,
        endUs,
        phase: phaseFor(e.name || ""),
      });
  };
  for (const e of selected) {
    if (e.ph === "X") push(e, e.ts + e.dur);
    else if (e.ph === "B") stack.push(e);
    else {
      const start = stack.pop();
      if (!start) {
        unmatchedEnds++;
        continue;
      }
      assert(
        !e.name || !start.name || e.name === start.name,
        "Mismatched synchronous B/E events",
      );
      push(start, e.ts);
    }
  }
  return { spans, unmatchedBegins: stack.length, unmatchedEnds };
}

function summarizeTask(spans, task, offsetMs) {
  assert(
    Number.isFinite(task.startTime) &&
      Number.isFinite(task.duration) &&
      task.duration > 0,
    "Invalid Long Task",
  );
  const start = (task.startTime + offsetMs) * 1000,
    end = start + task.duration * 1000;
  const clipped = spans
    .filter((s) => s.startUs < end && s.endUs > start)
    .map((s) => ({
      ...s,
      start: Math.max(start, s.startUs),
      end: Math.min(end, s.endUs),
    }));
  const boundaries = new Map([
    [start, { add: [], remove: [] }],
    [end, { add: [], remove: [] }],
  ]);
  for (const span of clipped) {
    for (const [time, kind] of [
      [span.start, "add"],
      [span.end, "remove"],
    ]) {
      if (!boundaries.has(time)) boundaries.set(time, { add: [], remove: [] });
      boundaries.get(time)[kind].push(span);
    }
  }
  const points = [...boundaries.keys()].sort((a, b) => a - b);
  const exclusiveMs = {},
    leafEventMs = {},
    current = new Set();
  // Sweep each boundary once; keep only active nesting, rather than rescanning
  // the entire trace for every slice. Each slice is still assigned exactly once.
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1],
      changes = boundaries.get(a);
    for (const span of changes.remove) current.delete(span);
    for (const span of changes.add) current.add(span);
    const active = [...current].sort(
      (x, y) =>
        x.endUs - x.startUs - (y.endUs - y.startUs) || y.startUs - x.startUs,
    );
    const crossing = active.some((span, index) =>
      active
        .slice(index + 1)
        .some(
          (parent) =>
            span.startUs < parent.startUs || span.endUs > parent.endUs,
        ),
    );
    const phase = crossing
      ? "ambiguous-overlap"
      : (active.find((s) => s.phase)?.phase ??
        (active.length ? "browser-other" : "untraced"));
    const duration = (b - a) / 1000;
    exclusiveMs[phase] = (exclusiveMs[phase] || 0) + duration;
    const leaf = active[0]?.name ?? "(untraced)";
    leafEventMs[leaf] = (leafEventMs[leaf] || 0) + duration;
  }
  return {
    ...task,
    exclusiveMs,
    accountedMs: Object.values(exclusiveMs).reduce((a, b) => a + b, 0),
    topLeafEvents: Object.entries(leafEventMs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, exclusiveMs]) => ({ name, exclusiveMs })),
    overlappingSpanCount: clipped.length,
  };
}

function analyzeBrowserTrace(trace, clock, longTasks, options = {}) {
  if (options.traceMetadata !== undefined) {
    assert(
      options.traceMetadata.dataLossOccurred === false,
      "Trace data loss or missing completeness status",
    );
  }
  const events = Array.isArray(trace) ? trace : trace.traceEvents;
  assert(Array.isArray(events), "Expected traceEvents");
  const thread = validateTraceThread(events, clock, options.markerToleranceMs);
  const { spans, ...incomplete } = synchronousSpans(events, thread);
  const offsetMs = clock.alignment.offsetMs;
  const afterBeforeMarker = clock.markers.find(
    (m) => m.phase === "before-replay",
  ).endTime;
  const beforeAfterMarker = clock.markers.find(
    (m) => m.phase === "after-replay",
  ).startTime;
  const window = options.replayWindow;
  if (window)
    assert(
      Number.isFinite(window.startTime) &&
        Number.isFinite(window.duration) &&
        window.duration > 0 &&
        window.startTime >= afterBeforeMarker &&
        window.startTime + window.duration <= beforeAfterMarker,
      "Replay window outside validated markers",
    );
  const windowStart = window?.startTime ?? afterBeforeMarker;
  const windowEnd = window
    ? window.startTime + window.duration
    : beforeAfterMarker;
  const observed = new Map(),
    crossingTasks = new Map();
  for (const span of spans) {
    if (!["RunTask", "ThreadControllerImpl::RunTask"].includes(span.name))
      continue;
    const startTime = span.startUs / 1000 - offsetMs;
    const endTime = span.endUs / 1000 - offsetMs;
    if (startTime < windowStart || endTime > windowEnd) {
      if (endTime > windowStart && startTime < windowEnd)
        crossingTasks.set(`${span.startUs}:${span.endUs}`, {
          startTime,
          duration: (span.endUs - span.startUs) / 1000,
          label:
            "Crosses replay/marker window boundary; excluded from longest fully-contained tasks",
          overlapMs:
            Math.min(endTime, windowEnd) - Math.max(startTime, windowStart),
        });
      continue;
    }
    observed.set(`${span.startUs}:${span.endUs}`, {
      startTime,
      duration: (span.endUs - span.startUs) / 1000,
    });
  }
  return {
    diagnostic: true,
    thread,
    incomplete,
    synchronousSpanCount: spans.length,
    capture: options.traceMetadata
      ? {
          browser: options.traceMetadata.browser,
          bytes: options.traceMetadata.bytes,
          dataLossOccurred: options.traceMetadata.dataLossOccurred,
        }
      : undefined,
    ...(window
      ? {
          replayPhaseCoverage: {
            ...summarizeTask(spans, window, offsetMs),
            windowBoundaryUncertaintyMs: 1,
          },
        }
      : {}),
    rendererRunTasks: {
      label: "Trace RunTask spans, not Long Task API entries",
      scope: window
        ? "Measured replay window from timeline"
        : "Between clock marker intervals; may include setup/verification outside measured replay",
      count: observed.size,
      boundaryCrossingCount: crossingTasks.size,
      boundaryCrossing: [...crossingTasks.values()]
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 10),
      longest: [...observed.values()]
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 10)
        .map((t) => summarizeTask(spans, t, offsetMs)),
    },
    tasks: longTasks.map((t) =>
      summarizeTask(spans, t, clock.alignment.offsetMs),
    ),
    note: "Exclusive phase durations partition each Long Task; parent and child durations are never added together. Names classify trace phases, not causal initiators. Unmatched boundary events are omitted; marker tolerance is separate from command-clock uncertainty. Other threads and asynchronous events are excluded.",
  };
}
module.exports = {
  phaseFor,
  validateTraceThread,
  synchronousSpans,
  summarizeTask,
  analyzeBrowserTrace,
};
if (require.main === module) {
  const fs = require("node:fs");
  const [tracePath, profilePath, resultPath, outputPath, timelinePath] =
    process.argv.slice(2);
  assert(
    tracePath && profilePath && resultPath && outputPath,
    "Usage: node analyze-browser-trace.cjs trace.json profile.cpuprofile result.json output.json [timeline.json]",
  );
  const timeline = timelinePath
    ? JSON.parse(fs.readFileSync(timelinePath))
    : undefined;
  const result = analyzeBrowserTrace(
    JSON.parse(fs.readFileSync(tracePath)),
    JSON.parse(fs.readFileSync(profilePath)).riftPageClock,
    JSON.parse(fs.readFileSync(resultPath)).longTaskEntries,
    {
      traceMetadata: JSON.parse(fs.readFileSync(tracePath + ".meta.json")),
      ...(timeline
        ? {
            replayWindow: {
              startTime: timeline.startedAt,
              duration: timeline.result.measuredDurationMs,
            },
          }
        : {}),
    },
  );
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n");
}
