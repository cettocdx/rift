import styles from "./rift-reasoning-orb.module.css";

/** Stepped terminal-dot activity indicator, shared by web and desktop sidebars. */
export function RiftReasoningOrb() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-ui="rift-reasoning-orb"
      className={styles.orb}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
    >
      {[
        [5.5, 4],
        [5.5, 8],
        [5.5, 12],
        [10.5, 4],
        [10.5, 8],
        [10.5, 12],
      ].map(([cx, cy], index) => (
        <circle key={index} className={styles.dot} cx={cx} cy={cy} r="1.15" />
      ))}
    </svg>
  );
}
