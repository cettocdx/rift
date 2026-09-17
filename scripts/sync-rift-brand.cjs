#!/usr/bin/env node
// Rebuild distribution assets from the approved, checked-in SVG originals.
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("node:module").createRequire(
  require.resolve("next/package.json"),
)("sharp");
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const brandDir = path.join(publicDir, "brand");

async function main() {
  const read = (name) => fs.readFile(path.join(brandDir, name), "utf8");
  const black = await read("Rift-Symbol-Black.svg");
  const white = await read("Rift-Symbol-White.svg");
  const horizontal = await read("Rift-Horizontal-White.svg");
  const darkIcon = await read("Rift-AppIcon-Dark.svg");
  const lightIcon = await read("Rift-AppIcon-Light.svg");
  const adaptive = black.replace(
    "><g",
    "><style>g{fill:#000}@media(prefers-color-scheme:dark){g{fill:#fff}}</style><g",
  );
  for (const [name, svg] of Object.entries({
    "rift-icon.svg": adaptive,
    "rift-icon-dark.svg": white,
    "rift-icon-mono.svg": black.replaceAll("#000000", "currentColor"),
    "rift-wordmark.svg": await read("Rift-Wordmark-Black.svg"),
    "rift-wordmark-light.svg": await read("Rift-Wordmark-White.svg"),
  }))
    await fs.writeFile(path.join(publicDir, name), svg);
  const png = (svg, size) =>
    sharp(Buffer.from(svg)).resize(size, size).ensureAlpha().png().toBuffer();
  for (const size of [192, 256, 512])
    await fs.writeFile(
      path.join(publicDir, `icon-${size}x${size}.png`),
      await png(black, size),
    );
  await fs.writeFile(path.join(root, "app/icon.png"), await png(black, 512));
  await fs.writeFile(
    path.join(publicDir, "favicon-32.png"),
    await png(black, 32),
  );
  for (const filename of ["public/apple-touch-icon.png", "app/apple-icon.png"])
    await fs.writeFile(path.join(root, filename), await png(lightIcon, 180));
  const sizes = [16, 32, 48, 256];
  const images = await Promise.all(sizes.map((size) => png(black, size)));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  images.forEach((image, i) => {
    const pos = 6 + i * 16;
    header[pos] = header[pos + 1] = sizes[i] === 256 ? 0 : sizes[i];
    header.writeUInt16LE(1, pos + 4);
    header.writeUInt16LE(32, pos + 6);
    header.writeUInt32LE(image.length, pos + 8);
    header.writeUInt32LE(offset, pos + 12);
    offset += image.length;
  });
  await fs.writeFile(
    path.join(publicDir, "favicon.ico"),
    Buffer.concat([header, ...images]),
  );
  // Keep existing public social URLs valid, but replace their old artwork.
  const headerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="500" viewBox="0 0 1500 500"><rect width="1500" height="500" fill="#101211"/><svg x="322" y="98" width="856" height="304" viewBox="0 0 428 152">${horizontal.slice(horizontal.indexOf(">") + 1, horizontal.lastIndexOf("</svg>"))}</svg></svg>`;
  const files = await fs.readdir(brandDir);
  for (const filename of files) {
    if (
      !/^rift-(?:x-|panda-|orbit-)/.test(filename) ||
      !/\.(svg|png|webp)$/.test(filename)
    )
      continue;
    const svg = filename.includes("header")
      ? headerSvg
      : filename.includes("logo")
        ? black
        : darkIcon;
    const dest = path.join(brandDir, filename);
    if (filename.endsWith(".svg")) await fs.writeFile(dest, svg);
    else {
      const metadata = await sharp(dest).metadata();
      await fs.writeFile(
        dest,
        await sharp(Buffer.from(svg))
          .resize(metadata.width, metadata.height, {
            fit: "contain",
            background: "#101211",
          })
          .toFormat(filename.endsWith(".webp") ? "webp" : "png")
          .toBuffer(),
      );
    }
  }
  await fs.writeFile(path.join(brandDir, "rift-header.svg"), headerSvg);
  await fs.writeFile(
    path.join(brandDir, "rift-header.png"),
    await sharp(Buffer.from(headerSvg)).png().toBuffer(),
  );
  console.log(
    "Updated web, PWA, favicon and social assets from RIFT Logo Package 11.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
