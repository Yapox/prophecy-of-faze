import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

// Encoding and responsive resizing only. Preserve the generated alpha channel.
const source = resolve(process.argv[2] || 'assets/odyssey/originals');
const output = resolve('public/odyssey');
await mkdir(output, { recursive: true });
for (const name of ['odysseus', 'athena', 'poseidon', 'ithaca']) {
  for (const [size, width] of [['desktop', name === 'ithaca' ? 1440 : 960], ['mobile', name === 'ithaca' ? 720 : 480]]) {
    const info = await sharp(resolve(source, `${name}.png`))
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 74, alphaQuality: 90, effort: 5 })
      .toFile(resolve(output, `${name}-${size}.webp`));
    console.log(`${name}-${size}.webp: ${info.width}x${info.height}, ${Math.round(info.size / 1024)} KiB`);
  }
}
