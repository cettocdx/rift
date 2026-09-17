import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { AgentPetRoleId } from "@/lib/ai/agents/pet-roster";

import styles from "./AgentPetAvatar.module.css";

const PET_PERSONAS: Record<
  AgentPetRoleId,
  { species: string; accessory: string }
> = {
  "build-engineer": { species: "bear", accessory: "hard hat and wrench" },
  "product-designer": {
    species: "cat",
    accessory: "stylus and pixel swatches",
  },
  research: { species: "fox", accessory: "field binoculars" },
  marketing: { species: "rabbit", accessory: "headset and megaphone" },
  quality: { species: "owl", accessory: "inspection lens" },
  "video-director": { species: "terrier", accessory: "director clapper" },
};

type PetArtProps = {
  role: AgentPetRoleId;
};

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 2,
};

function EyePair({ x1, x2, y }: { x1: number; x2: number; y: number }) {
  return (
    <g className={styles.eyes} fill="currentColor">
      <rect height="3" rx="1" width="2.5" x={x1} y={y} />
      <rect height="3" rx="1" width="2.5" x={x2} y={y} />
    </g>
  );
}

function ForgeArt() {
  return (
    <>
      <g className={styles.character}>
        <circle cx="20" cy="23" fill="var(--pet-muted)" r="7" />
        <circle cx="44" cy="23" fill="var(--pet-muted)" r="7" />
        <rect
          fill="var(--pet-paper)"
          height="29"
          rx="11"
          stroke="currentColor"
          strokeWidth="2"
          width="34"
          x="15"
          y="20"
        />
        <path
          d="M20 25h24v-3c0-7-5-11-12-11s-12 4-12 11z"
          fill="var(--pet-accent)"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        <path d="M16 25h32" {...strokeProps} />
        <EyePair x1={24} x2={37.5} y={31} />
        <path d="M28 41h8" {...strokeProps} />
      </g>
      <g className={styles.accessory}>
        <path
          d="M45 40l8 8M49 37a5 5 0 0 0 6 6l-4 4-6-6z"
          fill="var(--pet-accent)"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </g>
      <rect
        className={styles.signal}
        fill="var(--pet-accent)"
        height="3"
        rx="1"
        width="7"
        x="28.5"
        y="16"
      />
    </>
  );
}

function PixelArt() {
  return (
    <>
      <g className={styles.character}>
        <path
          d="M16 25l3-13 10 8h7l10-8 3 13v17c0 8-7 13-17 13S15 50 15 42z"
          fill="var(--pet-paper)"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        <path d="M20 18l7 5M44 18l-7 5" opacity=".42" {...strokeProps} />
        <EyePair x1={24} x2={37.5} y={31} />
        <path d="M30 39h4l-2 2z" fill="var(--pet-accent)" />
        <path d="M27 45c3 2 7 2 10 0" {...strokeProps} />
      </g>
      <g className={styles.accessory}>
        <path
          d="M45 36l10-10 3 3-10 10-4 1z"
          fill="var(--pet-accent)"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
        <rect
          fill="var(--pet-accent)"
          height="5"
          rx="1"
          width="5"
          x="7"
          y="40"
        />
        <rect
          fill="var(--pet-muted)"
          height="5"
          rx="1"
          width="5"
          x="7"
          y="47"
        />
      </g>
      <rect
        className={styles.signal}
        fill="var(--pet-accent)"
        height="5"
        rx="1"
        width="5"
        x="9"
        y="17"
      />
    </>
  );
}

function ScoutArt() {
  return (
    <>
      <g className={styles.character}>
        <path
          d="M16 25l2-15 12 9h4l12-9 2 15-5 25H21z"
          fill="var(--pet-accent)"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        <path
          d="M17 26l15 28 15-28-10 6H27z"
          fill="var(--pet-paper)"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        <path d="M29 43h6l-3 3z" fill="currentColor" />
      </g>
      <g className={styles.accessory}>
        <circle
          cx="25"
          cy="32"
          fill="var(--pet-paper)"
          r="6"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle
          cx="39"
          cy="32"
          fill="var(--pet-paper)"
          r="6"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path d="M31 31h2M19 29l-4-2M45 29l4-2" {...strokeProps} />
        <g className={styles.eyes} fill="currentColor">
          <circle cx="25" cy="32" r="1.5" />
          <circle cx="39" cy="32" r="1.5" />
        </g>
      </g>
      <path
        className={styles.signal}
        d="M51 14l2 3 3 1-3 2-1 3-2-3-3-1 3-2z"
        fill="var(--pet-accent)"
      />
    </>
  );
}

function EchoArt() {
  return (
    <>
      <g className={styles.character}>
        <rect
          fill="var(--pet-muted)"
          height="25"
          rx="8"
          stroke="currentColor"
          strokeWidth="2"
          width="10"
          x="20"
          y="5"
        />
        <rect
          fill="var(--pet-muted)"
          height="25"
          rx="8"
          stroke="currentColor"
          strokeWidth="2"
          width="10"
          x="34"
          y="5"
        />
        <rect
          fill="var(--pet-paper)"
          height="31"
          rx="13"
          stroke="currentColor"
          strokeWidth="2"
          width="32"
          x="16"
          y="23"
        />
        <EyePair x1={24} x2={37.5} y={34} />
        <path d="M29 43h6M32 40v6" {...strokeProps} />
        <path d="M18 30a15 15 0 0 1 28 0" {...strokeProps} />
        <rect
          fill="var(--pet-accent)"
          height="10"
          rx="3"
          stroke="currentColor"
          strokeWidth="1.8"
          width="5"
          x="13"
          y="31"
        />
      </g>
      <g className={styles.accessory}>
        <path
          d="M44 40l12-5v13l-12-4z"
          fill="var(--pet-accent)"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path d="M46 44l2 7h5l-3-6" {...strokeProps} />
      </g>
      <path
        className={styles.signal}
        d="M55 28h4M54 24l3-2M54 32l3 2"
        {...strokeProps}
        stroke="var(--pet-accent)"
      />
    </>
  );
}

function ProbeArt() {
  return (
    <>
      <g className={styles.character}>
        <path
          d="M16 20l7-9 4 8h10l4-8 7 9-3 27-13 9-13-9z"
          fill="var(--pet-paper)"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        <path
          d="M17 22l15 9 15-9M32 31v24"
          fill="var(--pet-accent)"
          opacity=".74"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <circle
          cx="25"
          cy="31"
          fill="var(--pet-muted)"
          r="7"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle
          cx="39"
          cy="31"
          fill="var(--pet-muted)"
          r="7"
          stroke="currentColor"
          strokeWidth="2"
        />
        <g className={styles.eyes} fill="currentColor">
          <circle cx="25" cy="31" r="2" />
          <circle cx="39" cy="31" r="2" />
        </g>
        <path
          d="M29 40l3 4 3-4z"
          fill="var(--pet-accent)"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </g>
      <g className={styles.accessory}>
        <circle
          cx="48"
          cy="43"
          fill="none"
          r="6"
          stroke="var(--pet-accent)"
          strokeWidth="2.5"
        />
        <path
          d="M52 48l5 6"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="3"
        />
      </g>
      <path
        className={styles.signal}
        d="M8 19h7M11.5 15v8"
        stroke="var(--pet-accent)"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </>
  );
}

function FrameArt() {
  return (
    <>
      <g className={styles.character}>
        <path
          d="M13 27c0-9 8-15 19-15s19 6 19 15v17c0 8-8 13-19 13S13 52 13 44z"
          fill="var(--pet-paper)"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M13 28c-6 0-7 8-3 18l7-5 1-12zM51 28c6 0 7 8 3 18l-7-5-1-12z"
          fill="var(--pet-accent)"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        <EyePair x1={24} x2={37.5} y={34} />
        <ellipse
          cx="32"
          cy="44"
          fill="var(--pet-muted)"
          opacity=".72"
          rx="7"
          ry="5"
        />
        <path
          d="M28 43h8l-4 4z"
          fill="var(--pet-accent)"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.6"
        />
        <path d="M29 50c2 1 4 1 6 0" {...strokeProps} />
      </g>
      <g className={styles.accessory}>
        <rect
          fill="var(--pet-accent)"
          height="8"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.8"
          width="32"
          x="16"
          y="15"
        />
        <path
          d="M17 15l6 8M26 15l6 8M35 15l6 8"
          stroke="var(--pet-paper)"
          strokeWidth="2"
        />
        <path
          d="M18 14l5-7 8 6 5-7 8 6"
          fill="none"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </g>
      <circle
        className={styles.signal}
        cx="53"
        cy="52"
        fill="var(--pet-accent)"
        r="2.5"
      />
    </>
  );
}

const PET_ART: Record<AgentPetRoleId, () => ReactNode> = {
  "build-engineer": ForgeArt,
  "product-designer": PixelArt,
  research: ScoutArt,
  marketing: EchoArt,
  quality: ProbeArt,
  "video-director": FrameArt,
};

function PetArt({ role }: PetArtProps) {
  const Art = PET_ART[role];
  return <Art />;
}

export type AgentPetAvatarProps = {
  accent: string;
  agentName: string;
  className?: string;
  label?: string;
  participating?: boolean;
  role: AgentPetRoleId;
  roleName: string;
  selected?: boolean;
  size?: number;
};

export function AgentPetAvatar({
  accent,
  agentName,
  className,
  label,
  participating = true,
  role,
  roleName,
  selected = false,
  size = 56,
}: AgentPetAvatarProps) {
  const persona = PET_PERSONAS[role];
  const accessibleLabel =
    label ??
    `${agentName}, ${roleName} agent pet. ${persona.species} with ${persona.accessory}.`;
  const style = {
    "--pet-accent": accent,
    "--pet-size": `${size}px`,
  } as CSSProperties;

  return (
    <span
      aria-label={accessibleLabel}
      className={cn(styles.avatar, className)}
      data-pet-accessory={persona.accessory}
      data-pet-role={role}
      data-pet-species={persona.species}
      data-selected={selected}
      data-workflow={participating}
      role="img"
      style={style}
    >
      <svg
        aria-hidden="true"
        className={styles.art}
        focusable="false"
        viewBox="0 0 64 64"
      >
        <PetArt role={role} />
      </svg>
    </span>
  );
}
