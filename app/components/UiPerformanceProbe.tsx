"use client";

import { useEffect } from "react";

/** Opt-in local diagnostics (release builds require an explicit build flag). No text, URLs, credentials or telemetry leave the page. */
export function UiPerformanceProbe() {
  useEffect(() => {
    if (
      (process.env.NODE_ENV !== "development" &&
        !(
          process.env.NEXT_PUBLIC_RIFT_PERF_PROBE === "1" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
        )) ||
      !new URLSearchParams(location.search).has("riftPerf")
    )
      return;
    const output = document.createElement("output");
    output.id = "rift-ui-performance";
    output.hidden = true;
    document.body.append(output);
    const events: { name: string; duration: number; delay: number }[] = [];
    const tasks: number[] = [];
    const frames: number[] = [];
    const frameGaps: {
      duration: number;
      trigger: string;
      sinceInputMs: number;
    }[] = [];
    const longFrames: {
      duration: number;
      blockingMs: number;
      forcedLayoutMs: number;
    }[] = [];
    let lastTrigger = "startup";
    let lastInput = 0;
    let shifts = 0;
    let activeUntil = 0;
    let previous = 0;
    let frame = 0;
    const percentile = (values: number[], p: number) => {
      if (!values.length) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      return (
        Math.round(
          sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] *
            10,
        ) / 10
      );
    };
    const publish = () => {
      const navigation = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      output.textContent = JSON.stringify({
        environment: process.env.NODE_ENV,
        responseMs: navigation
          ? Math.round(navigation.responseStart - navigation.requestStart)
          : null,
        domReadyMs: navigation
          ? Math.round(navigation.domContentLoadedEventEnd)
          : null,
        paints: performance
          .getEntriesByType("paint")
          .map((entry) => ({
            name: entry.name,
            ms: Math.round(entry.startTime),
          })),
        frameGaps: frameGaps.slice(-10),
        longFrames: longFrames.slice(-10),
        events: events.slice(-30),
        longTasks: tasks.length,
        longTaskMaxMs: Math.round(Math.max(0, ...tasks)),
        eventP95Ms: percentile(
          events.map((e) => e.duration),
          0.95,
        ),
        frameP95Ms: percentile(frames, 0.95),
        frameMaxMs: Math.round(Math.max(0, ...frames)),
        frameSamples: frames.length,
        layoutShift: Math.round(shifts * 1000) / 1000,
      });
    };
    const tick = (now: number) => {
      if (previous) {
        const duration = now - previous;
        frames.push(duration);
        if (frames.length > 10000) frames.shift();
        if (duration > 50) {
          frameGaps.push({
            duration: Math.round(duration),
            trigger: lastTrigger,
            sinceInputMs: Math.round(now - lastInput),
          });
          if (frameGaps.length > 40) frameGaps.shift();
        }
      }
      previous = now;
      if (now < activeUntil) frame = requestAnimationFrame(tick);
      else {
        frame = 0;
        previous = 0;
        publish();
      }
    };
    const interact = (event: Event) => {
      lastTrigger = event.type;
      lastInput = performance.now();
      activeUntil = performance.now() + 700;
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const observers: PerformanceObserver[] = [];
    for (const type of [
      "event",
      "longtask",
      "layout-shift",
      "long-animation-frame",
    ]) {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (type === "event") {
            const event = entry as PerformanceEventTiming;
            if (
              !(event as PerformanceEventTiming & { interactionId?: number })
                .interactionId
            )
              continue;
            events.push({
              name: event.name,
              duration: event.duration,
              delay: Math.round(event.processingStart - event.startTime),
            });
            if (events.length > 200) events.shift();
          } else if (type === "longtask") {
            tasks.push(entry.duration);
            if (tasks.length > 1000) tasks.shift();
          } else if (type === "long-animation-frame") {
            const animation = entry as PerformanceEntry & {
              blockingDuration: number;
              scripts?: { forcedStyleAndLayoutDuration: number }[];
            };
            longFrames.push({
              duration: Math.round(entry.duration),
              blockingMs: Math.round(animation.blockingDuration),
              forcedLayoutMs: Math.round(
                animation.scripts?.reduce(
                  (sum, script) => sum + script.forcedStyleAndLayoutDuration,
                  0,
                ) ?? 0,
              ),
            });
            if (longFrames.length > 40) longFrames.shift();
          } else if (
            !(entry as PerformanceEntry & { hadRecentInput?: boolean })
              .hadRecentInput
          )
            shifts += (entry as PerformanceEntry & { value: number }).value;
        }
        publish();
      });
      observer.observe({
        type,
        ...(type === "event" ? { durationThreshold: 16 } : {}),
      });
      observers.push(observer);
    }
    for (const type of ["pointerdown", "keydown", "wheel"])
      window.addEventListener(type, interact, { passive: true });
    publish();
    return () => {
      observers.forEach((observer) => observer.disconnect());
      cancelAnimationFrame(frame);
      for (const type of ["pointerdown", "keydown", "wheel"])
        window.removeEventListener(type, interact);
      output.remove();
    };
  }, []);
  return null;
}
