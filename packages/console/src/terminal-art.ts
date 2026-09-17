/** Approved Logo Package 11 cells, shared by the TUI and web console.
 * Precomputed with terminalLogo; parity tests keep these aligned with its vectors.
 * Keep this shared module independent of NodeNext-only runtime imports. */
export const RIFT_WORDMARK = [
  "                                  ",
  "       ⣦⣄    ⣿⣿⠿⠿⢿⣷⣦⡀⠿⠿ ⢰⣿⡿⠿⣤⣤    ",
  "  ⢀⣀⣀⣤⣴⣿⣿⡷   ⣿⣿   ⣸⣿⡇⣶⣶⢰⣾⣿⣶⡆⣿⣿⣶⣶  ",
  "  ⢲⣶⣶⡶⠒⠒     ⣿⣿⠿⢿⣿⣟⠋ ⣿⣿ ⢸⣿  ⣿⣿    ",
  "   ⠙⠻⡀       ⣿⣿  ⠹⣿⣧⡀⣿⣿ ⢸⣿  ⠹⣿⣶⣶  ",
  "                                  ",
] as const;
export const RIFT_COMPACT_LOGO = ["   ⢠⡀ ", " ⣴⣶⠿⠟   Rift", " ⠈⠃   "] as const;
export const HAND_CYCLE_MS = 5600;
export const HAND_FRAME_COUNT = 16;
export const TERMINAL_COLORS = {
  background: "#141414",
  ink: "#c7c7c7",
  muted: "#828282",
};

type Point = [number, number];
const line = (...points: Point[]) => points;
function curve(a: Point, b: Point, c: Point, d: Point): Point[] {
  return Array.from({ length: 49 }, (_, i) => {
    const t = i / 48,
      u = 1 - t;
    return [
      u * u * u * a[0] +
        3 * u * u * t * b[0] +
        3 * u * t * t * c[0] +
        t * t * t * d[0],
      u * u * u * a[1] +
        3 * u * u * t * b[1] +
        3 * u * t * t * c[1] +
        t * t * t * d[1],
    ];
  });
}
const human: Point[][] = [
  curve([0, 151], [45, 139], [92, 112], [126, 94]),
  curve([126, 94], [152, 78], [172, 79], [192, 75]),
  curve([192, 75], [221, 70], [258, 60], [289, 68]),
  curve([289, 68], [305, 71], [298, 82], [282, 83]),
  curve([282, 83], [250, 85], [225, 91], [202, 95]),
  curve([202, 95], [216, 103], [215, 119], [205, 124]),
  curve([205, 124], [213, 136], [204, 147], [191, 145]),
  curve([191, 145], [188, 157], [177, 159], [166, 151]),
  curve([166, 151], [154, 166], [140, 159], [124, 149]),
  curve([124, 149], [117, 146], [112, 149], [109, 155]),
  curve([109, 155], [81, 172], [52, 187], [20, 201]),
  curve([123, 107], [149, 99], [178, 100], [202, 95]),
  curve([133, 111], [150, 110], [156, 126], [171, 131]),
  curve([171, 131], [184, 136], [187, 125], [180, 117]),
  curve([180, 117], [174, 111], [171, 107], [165, 105]),
  curve([180, 117], [193, 117], [199, 119], [205, 124]),
  curve([171, 131], [181, 138], [186, 142], [191, 145]),
  curve([151, 132], [155, 139], [161, 147], [166, 151]),
  curve([74, 147], [90, 139], [108, 126], [117, 114]),
  curve([68, 159], [88, 151], [102, 146], [117, 143]),
  curve([205, 77], [207, 83], [207, 88], [208, 93]),
  curve([250, 69], [252, 74], [251, 80], [250, 85]),
  curve([270, 70], [278, 67], [291, 71], [290, 76]),
];
const robot: Point[][] = [
  line(
    [640, 8],
    [578, 31],
    [545, 43],
    [510, 43],
    [485, 55],
    [456, 60],
    [433, 70],
    [389, 76],
    [348, 82],
    [341, 87],
    [347, 93],
    [397, 94],
    [434, 90],
    [456, 94],
  ),
  line(
    [456, 94],
    [432, 108],
    [423, 122],
    [430, 133],
    [439, 132],
    [453, 118],
    [470, 112],
  ),
  line([470, 112], [455, 135], [460, 146], [470, 146], [484, 126], [492, 116]),
  line(
    [492, 116],
    [485, 139],
    [493, 148],
    [503, 143],
    [513, 121],
    [534, 108],
    [559, 99],
    [589, 85],
    [640, 72],
  ),
  line([456, 60], [463, 75], [456, 94], [470, 112], [492, 116], [513, 121]),
  line([485, 55], [502, 64], [510, 83], [534, 108]),
  line([545, 43], [555, 66], [559, 99]),
  line([578, 31], [592, 55], [589, 85]),
  line([388, 76], [392, 94]),
  line([432, 71], [436, 89]),
  line([353, 84], [358, 90], [381, 88]),
  line(
    [469, 73],
    [485, 69],
    [497, 76],
    [499, 91],
    [483, 101],
    [468, 94],
    [469, 73],
  ),
  line(
    [474, 79],
    [484, 76],
    [492, 80],
    [492, 88],
    [483, 94],
    [475, 89],
    [474, 79],
  ),
  line([431, 119], [440, 122]),
  line([456, 134], [468, 137]),
  line([490, 133], [502, 137]),
  line([563, 52], [582, 45]),
  line([566, 59], [585, 52]),
  line([568, 66], [586, 59]),
];

const cache = new Map<string, string[]>();
/** Rasterise our contour artwork into real braille cells, with no image assets. */
export function terminalHands(columns = 66, rows = 14, frame = 0): string[] {
  const step =
    ((Math.floor(frame) % HAND_FRAME_COUNT) + HAND_FRAME_COUNT) %
    HAND_FRAME_COUNT;
  const key = `${columns}:${rows}:${step}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const width = columns * 2,
    height = rows * 4;
  const dots = new Uint8Array(width * height);
  const approach = (1 - Math.cos((step / HAND_FRAME_COUNT) * Math.PI * 2)) * 5;
  for (const [paths, offset] of [
    [human, approach],
    [robot, -approach],
  ] as const) {
    for (const path of paths)
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1],
          b = path[i];
        const count = Math.max(
          1,
          Math.ceil(((Math.hypot(b[0] - a[0], b[1] - a[1]) * width) / 640) * 2),
        );
        for (let j = 0; j <= count; j++) {
          const t = j / count;
          const x = Math.round(
            ((a[0] + (b[0] - a[0]) * t + offset) / 640) * (width - 1),
          );
          const y = Math.round(
            ((a[1] + (b[1] - a[1]) * t) / 208) * (height - 1),
          );
          if (x >= 0 && x < width && y >= 0 && y < height)
            dots[y * width + x] = 1;
        }
      }
  }
  const bits = [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 1],
    [1, 2],
    [0, 3],
    [1, 3],
  ];
  const result = Array.from({ length: rows }, (_, y) =>
    Array.from({ length: columns }, (_, x) => {
      let cell = 0;
      bits.forEach(([dx, dy], bit) => {
        if (dots[(y * 4 + dy) * width + x * 2 + dx]) cell |= 1 << bit;
      });
      return cell ? String.fromCodePoint(0x2800 + cell) : " ";
    }).join(""),
  );
  cache.set(key, result);
  return result;
}
export function terminalHandFrame(time: number): number {
  return Math.floor(
    ((Math.max(0, time) % HAND_CYCLE_MS) / HAND_CYCLE_MS) * HAND_FRAME_COUNT,
  );
}
