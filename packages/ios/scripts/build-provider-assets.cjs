// Render the original brand SVGs into explicit Retina assets. Apple's SVG
// compiler misrenders compressed paths in some of these supplied SVGs.
// Requires sharp (resolve through NODE_PATH when using the bundled runtime).
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
(async () => {
  const root = path.resolve(__dirname, '../Resources/Providers.xcassets');
  const sources = path.resolve(__dirname, '../BrandSources');
  fs.mkdirSync(sources, {recursive: true});
  for (const name of fs.readdirSync(root).filter(n => n.endsWith('.imageset'))) {
    const folder = path.join(root, name);
    const source = path.join(sources, name.replace('.imageset', '.svg'));
    if (!fs.existsSync(source)) fs.copyFileSync(path.join(folder, 'mark.svg'), source);
    const images = [];
    for (const scale of [1, 2, 3]) {
      const filename = `mark@${scale}x.png`;
      await sharp(source, {density: 288}).resize(24 * scale, 24 * scale).png().toFile(path.join(folder, filename));
      images.push({idiom: 'universal', filename, scale: `${scale}x`});
    }
    fs.writeFileSync(path.join(folder, 'Contents.json'), JSON.stringify({images, info: {author: 'xcode', version: 1}, properties: {'template-rendering-intent': 'original'}}, null, 2) + '\n');
    fs.rmSync(path.join(folder, 'mark.svg'), {force: true});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
