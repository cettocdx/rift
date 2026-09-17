"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A counter whose digits roll when they change — the aicss task-list's
 * odometer, as a reusable piece. Each slot keeps the old glyph and the new
 * one in a column and slides one em; a digit that did not change stays put,
 * so "3/5" becoming "4/5" moves exactly one wheel.
 */
function RollDigit({ char }: { char: string }) {
  const prev = useRef(char);
  const [roll, setRoll] = useState<{ from: string; to: string } | null>(null);
  const [up, setUp] = useState(false);

  useEffect(() => {
    if (char === prev.current) return;
    const from = prev.current;
    prev.current = char;
    setRoll({ from, to: char });
    setUp(false);
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => setUp(true)),
    );
    const done = setTimeout(() => setRoll(null), 380);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
  }, [char]);

  if (!roll) return <span className="rift-roll">{char}</span>;
  return (
    <span className="rift-roll">
      <span className={`rift-roll-inner ${up ? "rift-roll-up" : ""}`}>
        <span>{roll.from}</span>
        <span>{roll.to}</span>
      </span>
    </span>
  );
}

export function RollingCount({ value }: { value: string }) {
  return (
    <span aria-label={value} className="tabular-nums">
      {value.split("").map((char, index) => (
        <RollDigit key={index} char={char} />
      ))}
    </span>
  );
}
