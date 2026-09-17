import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

type AlphaBounds = {
  width: number;
  height: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(left: number, above: number, upperLeft: number) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function alphaBounds(png: Buffer): AlphaBounds {
  expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const compressed: Buffer[] = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      compressed.push(data);
    }
    offset += length + 12;
  }

  expect({ bitDepth, colorType, interlace }).toEqual({
    bitDepth: 8,
    colorType: 6,
    interlace: 0,
  });

  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(stride * height);
  let sourceOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset];
    sourceOffset += 1;
    for (let x = 0; x < stride; x += 1) {
      const encoded = filtered[sourceOffset];
      sourceOffset += 1;
      const outputOffset = y * stride + x;
      const left = x >= bytesPerPixel ? pixels[outputOffset - 4] : 0;
      const above = y > 0 ? pixels[outputOffset - stride] : 0;
      const upperLeft =
        y > 0 && x >= bytesPerPixel
          ? pixels[outputOffset - stride - bytesPerPixel]
          : 0;

      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      else expect(filter).toBe(0);
      pixels[outputOffset] = (encoded + predictor) & 0xff;
    }
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[y * stride + x * bytesPerPixel + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return { width, height, minX, minY, maxX, maxY };
}

function icoPng(icon: Buffer, requestedWidth: number) {
  const count = icon.readUInt16LE(4);
  for (let index = 0; index < count; index += 1) {
    const entryOffset = 6 + index * 16;
    const width = icon[entryOffset] || 256;
    if (width !== requestedWidth) continue;
    const byteLength = icon.readUInt32LE(entryOffset + 8);
    const imageOffset = icon.readUInt32LE(entryOffset + 12);
    return icon.subarray(imageOffset, imageOffset + byteLength);
  }
  throw new Error(`Missing ${requestedWidth}px image in favicon.ico`);
}

function margins(bounds: AlphaBounds) {
  return [
    bounds.minX,
    bounds.minY,
    bounds.width - 1 - bounds.maxX,
    bounds.height - 1 - bounds.maxY,
  ];
}

describe("transparent web favicon", () => {
  it("keeps a one-pixel optical safe area at 16px", () => {
    const icon = readFileSync(join(process.cwd(), "public/favicon.ico"));
    const bounds = alphaBounds(icoPng(icon, 16));

    const [left, top, right, bottom] = margins(bounds);

    expect(bounds).toMatchObject({ width: 16, height: 16 });
    // The mark is wider than it is tall, so equal margins on all four sides
    // would mean a stretched logo. Horizontal margins stay symmetric and the
    // vertical ones follow the artwork's proportion.
    expect(left).toBe(right);
    expect(left).toBeGreaterThan(0);
    expect(top).toBeGreaterThanOrEqual(left);
    expect(bottom).toBeGreaterThanOrEqual(left);
  });

  it("preserves the approved clear space at 32px", () => {
    const bounds = alphaBounds(
      readFileSync(join(process.cwd(), "public/favicon-32.png")),
    );

    const [left, top, right, bottom] = margins(bounds);

    expect(bounds).toMatchObject({ width: 32, height: 32 });
    expect(left).toBe(right);
    expect(left).toBeGreaterThanOrEqual(4);
    expect(top).toBeGreaterThanOrEqual(4);
    expect(bottom).toBeGreaterThanOrEqual(4);
    expect((bounds.maxX - bounds.minX + 1) / bounds.width).toBeCloseTo(0.69, 1);
  });

  it("keeps the PWA canvas transparent and separate from square native icons", () => {
    const web = alphaBounds(
      readFileSync(join(process.cwd(), "public/icon-512x512.png")),
    );
    const native = readFileSync(
      join(process.cwd(), "packages/desktop/src-tauri/icons/icon.png"),
    );
    const webBuffer = readFileSync(
      join(process.cwd(), "public/icon-512x512.png"),
    );

    expect(margins(web).every((margin) => margin > 0)).toBe(true);
    expect((web.maxX - web.minX + 1) / web.width).toBeGreaterThan(0.65);
    expect((web.maxX - web.minX + 1) / web.width).toBeLessThan(0.75);
    expect(webBuffer.equals(native)).toBe(false);
  });
});
