"use client";

import { useCallback, useEffect, useRef, useState, type UIEvent } from "react";

/** New output follows only while the reader chooses to stay near the bottom. */
export function useTranscriptFollow(revision: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const [following, setFollowing] = useState(true);
  useEffect(() => {
    const element = scrollRef.current;
    if (element && followRef.current) element.scrollTop = element.scrollHeight;
  }, [revision]);
  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const next =
      element.scrollHeight - element.clientHeight - element.scrollTop < 80;
    followRef.current = next;
    setFollowing(next);
  }, []);
  const followLatest = useCallback(() => {
    followRef.current = true;
    setFollowing(true);
    const element = scrollRef.current;
    element?.scrollTo({
      top: element.scrollHeight,
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, []);
  return { scrollRef, following, onScroll, followLatest };
}
