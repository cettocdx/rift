const roundToFourPlaces = (value: number) => Number(value.toFixed(4));

const SEGMENTS = Array.from({ length: 48 }, (_, index) => {
  const angle = (index / 48) * 360;
  const phase = Math.sin((index / 48) * Math.PI * 6);
  return {
    angle,
    inner: roundToFourPlaces(55 + phase * 5),
    outer: roundToFourPlaces(91 - phase * 7),
    opacity: roundToFourPlaces(0.35 + ((phase + 1) / 2) * 0.65),
  };
});

const APERTURE_MOTION_STYLES = `
  .f1-aperture-motion {
    animation: f1-aperture-enter 900ms cubic-bezier(0.23, 1, 0.32, 1) both;
    transform-origin: 120px 120px;
  }
  @keyframes f1-aperture-enter {
    from { opacity: 0; transform: rotate(-8deg); }
    to { opacity: 1; transform: rotate(0deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .f1-aperture-motion {
      animation: none;
      opacity: 1;
      transform: none;
    }
  }
`;

export function ApertureSignature({
  className = "",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <div data-compact={compact ? "true" : "false"} className={className}>
      <svg
        viewBox="0 0 240 240"
        aria-hidden="true"
        focusable="false"
        className="size-full overflow-visible"
      >
        <style>{APERTURE_MOTION_STYLES}</style>
        <g className="f1-aperture-motion">
          {SEGMENTS.map((segment) => (
            <line
              key={segment.angle}
              x1="120"
              y1={120 - segment.inner}
              x2="120"
              y2={120 - segment.outer}
              stroke="currentColor"
              strokeWidth={compact ? 2.25 : 2.75}
              strokeLinecap="round"
              opacity={segment.opacity}
              transform={`rotate(${segment.angle} 120 120)`}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
