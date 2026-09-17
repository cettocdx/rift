/** RIFT Logo Package 11 geometry. Terminal dots are square at a 1:2 cell ratio. */
export const RIFT_SYMBOL_PATH =
  "M55 7C70 16 85 27 91 39Q95 47 81 47H9C40 43 57 37 60 27C62 20 59 12 55 7Z";
const WORDMARK_PATHS = [
  "M0 100V0H54C79 0 94 12 94 33C94 48 85 58 69 63L95 100H65L41 66H25V100ZM25 20V47H51C63 47 68 42 68 33C68 24 63 20 51 20Z",
  "M102 28H126V100H102ZM102 0H126V20H102Z",
  "M141 100V47H133V28H141V25C141 6 153 -3 173 -3Q180 -3 187 -2V16Q182 15 178 15C168 15 165 19 165 28H185V47H165V100Z",
  "M191 12H215V28H237V47H215V75Q215 83 225 83H239V100Q230 101 224 101C202 101 191 92 191 75Z",
];
type Point = readonly [number, number];
type Shape = Point[][];

// The supplied paths use only absolute M/L/H/V/C/Q/Z commands. Flatten their
// curves once; sampling the filled contours preserves the R counter's hole.
function contours(path: string): Shape {
  const tokens = path.match(/[MLHVCQZ]|-?\d+(?:\.\d+)?/g)!;
  const result: Shape = [];
  let point: Point = [0, 0];
  let contour: Point[] = [];
  let i = 0;
  const number = () => Number(tokens[i++]);
  const pair = (): Point => [number(), number()];
  const add = (next: Point) => {
    contour.push(next);
    point = next;
  };
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === "M") {
      contour = [];
      result.push(contour);
      add(pair());
    } else if (command === "L") add(pair());
    else if (command === "H") add([number(), point[1]]);
    else if (command === "V") add([point[0], number()]);
    else if (command === "C" || command === "Q") {
      const start = point;
      const a = pair(),
        b = pair(),
        end = command === "C" ? pair() : b;
      for (let step = 1; step <= 32; step++) {
        const t = step / 32,
          u = 1 - t;
        add(
          command === "C"
            ? [
                u ** 3 * start[0] +
                  3 * u * u * t * a[0] +
                  3 * u * t * t * b[0] +
                  t ** 3 * end[0],
                u ** 3 * start[1] +
                  3 * u * u * t * a[1] +
                  3 * u * t * t * b[1] +
                  t ** 3 * end[1],
              ]
            : [
                u * u * start[0] + 2 * u * t * a[0] + t * t * end[0],
                u * u * start[1] + 2 * u * t * a[1] + t * t * end[1],
              ],
        );
      }
    } else if (command === "Z") point = contour[0];
    else throw new Error(`Unsupported RIFT path command: ${command}`);
  }
  return result;
}
const transform = (shape: Shape, scale: number, x: number, y: number): Shape =>
  shape.map((contour) =>
    contour.map(([px, py]) => [px * scale + x, py * scale + y]),
  );
const sweep = contours(RIFT_SYMBOL_PATH);
const reverseSweep = transform(sweep, -1, 100, 100);
const symbol = [sweep, reverseSweep].map((shape) =>
  transform(shape, 1, 12, 12),
);
const horizontal = [
  ...[sweep, reverseSweep].map((shape) => transform(shape, 1.2, 16, 17)),
  ...WORDMARK_PATHS.map((path) => transform(contours(path), 1, 165, 27)),
];

function contains(shape: Shape, x: number, y: number): boolean {
  let inside = false;
  for (const contour of shape) {
    for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
      const [ax, ay] = contour[i],
        [bx, by] = contour[j];
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
        inside = !inside;
    }
  }
  return inside;
}
const BRAILLE_DOTS = [
  [0, 0],
  [0, 1],
  [0, 2],
  [1, 0],
  [1, 1],
  [1, 2],
  [0, 3],
  [1, 3],
];
const cache = new Map<string, readonly string[]>();

/** Fit without stretching, including the package's clear space. No image runtime. */
export function terminalLogo(
  kind: "symbol" | "horizontal",
  columns: number,
  rows: number,
): readonly string[] {
  if (
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    columns < 1 ||
    rows < 1 ||
    columns > 120 ||
    rows > 60
  )
    throw new RangeError(
      "Terminal logo dimensions must be 1–120 columns and 1–60 rows.",
    );
  const key = `${kind}:${columns}:${rows}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const [viewWidth, viewHeight, shapes] =
    kind === "symbol"
      ? ([124, 124, symbol] as const)
      : ([428, 152, horizontal] as const);
  const scale = Math.min((columns * 2) / viewWidth, (rows * 4) / viewHeight);
  const left = (columns * 2 - viewWidth * scale) / 2;
  const top = (rows * 4 - viewHeight * scale) / 2;
  const result = Object.freeze(
    Array.from({ length: rows }, (_, row) =>
      Array.from({ length: columns }, (_, column) => {
        let cell = 0;
        BRAILLE_DOTS.forEach(([dx, dy], bit) => {
          const x = (column * 2 + dx + 0.5 - left) / scale;
          const y = (row * 4 + dy + 0.5 - top) / scale;
          if (shapes.some((shape) => contains(shape, x, y))) cell |= 1 << bit;
        });
        return cell ? String.fromCodePoint(0x2800 + cell) : " ";
      }).join(""),
    ),
  );
  cache.set(key, result);
  return result;
}
