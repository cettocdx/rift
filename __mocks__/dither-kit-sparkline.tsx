/**
 * The real Sparkline paints an ordered-dither area chart onto canvas, which
 * jsdom cannot rasterise and next/jest cannot even parse (d3's ESM never
 * clears the transformer). Tests care about the contract, not the pixels:
 * what data reached the chart, and that it rendered at all.
 */
export function Sparkline({
  data,
  color,
  className,
}: {
  data: number[];
  color: string;
  className?: string;
}) {
  return (
    <div
      data-testid="dither-sparkline"
      data-color={color}
      data-points={data.join(",")}
      className={className}
    />
  );
}
