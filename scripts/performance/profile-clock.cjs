const assert = require("node:assert/strict");
// CDP Performance Timestamp (timeTicks seconds) and CPU profile timestamps
// (microseconds) share Chromium's monotonic clock. Bracketing the metric request
// with page performance.now bounds IPC latency instead of hiding it in an offset.
function alignClock(anchors) {
  assert(anchors.length, "At least one shared-clock anchor is required");
  const bounds = anchors.map((a) => ({
    low: a.timestampSeconds * 1000 - a.pageAfterMs,
    high: a.timestampSeconds * 1000 - a.pageBeforeMs,
  }));
  const offsetLowMs = Math.max(...bounds.map((b) => b.low));
  const offsetHighMs = Math.min(...bounds.map((b) => b.high));
  const valid =
    Number.isFinite(offsetLowMs) &&
    Number.isFinite(offsetHighMs) &&
    offsetLowMs <= offsetHighMs;
  return {
    valid,
    offsetLowMs,
    offsetHighMs,
    ...(valid
      ? {
          offsetMs: (offsetLowMs + offsetHighMs) / 2,
          uncertaintyMs: (offsetHighMs - offsetLowMs) / 2,
        }
      : {}),
    method:
      "CDP Performance timeTicks Timestamp bracketed by page performance.now; CPU timestamp microseconds",
  };
}
function profileSamples(profile, clock) {
  assert(
    clock.valid,
    "Cannot correlate a CPU profile without a valid shared clock",
  );
  assert(
    profile.samples?.length === profile.timeDeltas?.length,
    "CPU samples and deltas must match",
  );
  let timestampUs = profile.startTime;
  return profile.samples.map((nodeId, index) => {
    const deltaUs = profile.timeDeltas[index];
    timestampUs += deltaUs;
    return {
      nodeId,
      timestampUs,
      pageMs: timestampUs / 1000 - clock.offsetMs,
      deltaMs: deltaUs / 1000,
    };
  });
}
function nodeIndex(profile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parents = new Map();
  for (const n of profile.nodes)
    for (const child of n.children || []) parents.set(child, n.id);
  return { nodes, parents };
}
function summarizeWindow(profile, clock, startTime, duration) {
  const { nodes, parents } = nodeIndex(profile);
  const samples = profileSamples(profile, clock).filter(
    (s) => s.pageMs >= startTime && s.pageMs <= startTime + duration,
  );
  const self = new Map(),
    inclusive = new Map();
  for (const sample of samples) {
    self.set(sample.nodeId, (self.get(sample.nodeId) || 0) + 1);
    let id = sample.nodeId;
    const seen = new Set();
    while (id !== undefined && !seen.has(id)) {
      seen.add(id);
      inclusive.set(id, (inclusive.get(id) || 0) + 1);
      id = parents.get(id);
    }
  }
  const top = (counts) =>
    [...counts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16)
      .map(([id, count]) => ({
        ...nodes.get(id)?.callFrame,
        nodeId: id,
        samples: count,
      }));
  return {
    startTime,
    duration,
    clockUncertaintyMs: clock.uncertaintyMs,
    sampleCount: samples.length,
    maxSampleDeltaMs: samples.length
      ? Math.max(...samples.map((s) => s.deltaMs))
      : null,
    topSelf: top(self),
    topInclusive: top(inclusive),
  };
}
function validateMarkers(profile, clock, markers) {
  const { nodes, parents } = nodeIndex(profile);
  const belongs = (id) => {
    while (id !== undefined) {
      if (nodes.get(id)?.callFrame.functionName === "riftProfileClockMarker")
        return true;
      id = parents.get(id);
    }
    return false;
  };
  const markerSamples = profileSamples(profile, clock).filter((s) =>
    belongs(s.nodeId),
  );
  return markers.map((marker) => {
    const samples = markerSamples.filter(
      (s) =>
        s.pageMs >= marker.startTime - clock.uncertaintyMs &&
        s.pageMs <= marker.endTime + clock.uncertaintyMs,
    );
    return {
      ...marker,
      sampleCount: samples.length,
      firstSamplePageMs: samples[0]?.pageMs,
      lastSamplePageMs: samples.at(-1)?.pageMs,
      validated: samples.length >= 3,
    };
  });
}
module.exports = {
  alignClock,
  profileSamples,
  summarizeWindow,
  validateMarkers,
};
