import type { CSSProperties } from "react";
import {
  HAND_CYCLE_MS,
  HAND_FRAME_COUNT,
  RIFT_WORDMARK,
  terminalHands,
} from "@/packages/console/src/terminal-art";
import styles from "./RiftTerminalArt.module.css";

const frames = Array.from({ length: HAND_FRAME_COUNT }, (_, i) =>
  terminalHands(66, 12, i).join("\n"),
);

/** A character-cell illustration, identical to the standalone terminal artwork. */
export function RiftTerminalArt() {
  return (
    <div className={styles.art} data-rift-character-art>
      <pre className={styles.wordmark} aria-label="RIFT">
        {RIFT_WORDMARK.join("\n")}
      </pre>
      <div
        className={styles.hands}
        role="img"
        aria-label="A human hand and a robotic hand reaching towards each other"
      >
        {frames.map((frame, i) => (
          <pre
            key={i}
            aria-hidden
            className={styles.frame}
            style={
              {
                "--hand-duration": `${HAND_CYCLE_MS}ms`,
                "--hand-delay": `${(-((HAND_FRAME_COUNT - i) % HAND_FRAME_COUNT) * HAND_CYCLE_MS) / HAND_FRAME_COUNT}ms`,
              } as CSSProperties
            }
          >
            {frame}
          </pre>
        ))}
      </div>
    </div>
  );
}
