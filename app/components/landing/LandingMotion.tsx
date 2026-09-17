"use client";

import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";

import styles from "./LandingMotion.module.css";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function useOneShotReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const node = ref.current;

    if (!node) return;

    node.dataset.motionState = "visible";

    if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
      return;
    }

    node.dataset.motionState = "pending";
    let completed = false;

    const observer = new IntersectionObserver(
      (entries) => {
        if (completed || !entries.some((entry) => entry.isIntersecting)) {
          return;
        }

        completed = true;
        node.dataset.motionState = "visible";
        node.dataset.motionComplete = "true";
        observer.disconnect();
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return ref;
}

export function LandingReveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useOneShotReveal<HTMLDivElement>();
  const style = {
    ["--landing-reveal-delay" as string]: `${delay}ms`,
  } as CSSProperties;

  return (
    <div
      ref={ref}
      className={`${styles.reveal} ${className}`}
      data-motion-state="visible"
      style={style}
    >
      {children}
    </div>
  );
}

export function LandingSequenceText({ text }: { text: string }) {
  const ref = useOneShotReveal<HTMLSpanElement>();
  const words = text.trim().split(/\s+/u);

  return (
    <span ref={ref} className={styles.sequence} data-motion-state="visible">
      {words.map((word, index) => (
        <span key={`${word}-${index}`}>
          <span
            className={styles.word}
            style={
              {
                ["--landing-word-index" as string]: index,
              } as CSSProperties
            }
          >
            {word}
          </span>
          {index < words.length - 1 ? " " : null}
        </span>
      ))}
    </span>
  );
}

export function LandingCountUp({
  value,
  suffix = "",
  duration = 900,
  className = "",
}: {
  value: number;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const valueRef = useRef<HTMLSpanElement>(null);
  const formattedValue = `${new Intl.NumberFormat("en-US").format(value)}${suffix}`;

  useLayoutEffect(() => {
    const node = valueRef.current;

    if (!node) return;

    node.textContent = formattedValue;

    if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
      return;
    }

    let animationFrame = 0;
    let started = false;

    node.textContent = `0${suffix}`;

    const observer = new IntersectionObserver(
      (entries) => {
        if (started || !entries.some((entry) => entry.isIntersecting)) return;

        started = true;
        observer.disconnect();
        const startedAt = performance.now();

        const tick = (now: number) => {
          const progress = Math.min((now - startedAt) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          const current = Math.round(value * eased);

          node.textContent = `${new Intl.NumberFormat("en-US").format(current)}${suffix}`;

          if (progress < 1) {
            animationFrame = window.requestAnimationFrame(tick);
          } else {
            node.dataset.motionComplete = "true";
          }
        };

        animationFrame = window.requestAnimationFrame(tick);
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.35 },
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
    };
  }, [duration, formattedValue, suffix, value]);

  return (
    <span
      className={`inline-block text-right tabular-nums ${className}`}
      aria-label={formattedValue}
      style={{ minWidth: `${formattedValue.length}ch` }}
    >
      <span ref={valueRef} aria-hidden="true">
        {formattedValue}
      </span>
    </span>
  );
}
