import type { CSSProperties } from "react";
import styles from "./project-bots.module.css";

const identities = [
  { color: "#a48acb", angle: 0 },
  { color: "#6b9ac4", angle: 90 },
  { color: "#ca8d73", angle: 45 },
  { color: "#83a68d", angle: 135 },
  { color: "#b59666", angle: 180 },
  { color: "#b282a8", angle: 225 },
  { color: "#7da9a4", angle: 270 },
  { color: "#9b9cc0", angle: 315 },
];

/** A split core: restrained role colour, recognisable at sidebar scale. */
export function BotAvatar({
  identity,
  size = 40,
}: {
  identity: string;
  size?: number;
}) {
  const hash = Array.from(identity).reduce(
    (value, char) => (value * 31 + char.charCodeAt(0)) >>> 0,
    0,
  );
  const visual = identities[hash % identities.length];
  return (
    <span
      className={styles.avatar}
      style={
        {
          width: size,
          height: size,
          "--bot-accent": visual.color,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <svg viewBox="0 0 40 40" fill="none" width="100%" height="100%">
        <g
          transform={`rotate(${visual.angle} 20 20)`}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M11 18v-5a2 2 0 0 1 2-2h9l-4 7h-7ZM29 22v5a2 2 0 0 1-2 2h-9l4-7h7Z" />
          <path d="m25 11 4 7h-5M15 29l-4-7h5" opacity=".65" />
        </g>
        <circle cx="20" cy="20" r="1.3" fill="currentColor" />
      </svg>
    </span>
  );
}
