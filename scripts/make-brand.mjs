// Builds every brand image the site needs from the official logo SVGs in public/brand/
// (extracted from the Blush Picnic Logo Guide; replace those files with the designer's
// originals any time and run `npm run brand` again).
//
//   public/favicon.svg            app icon (scales in the browser tab)
//   public/favicon.ico            16/32/48 px, from the simplified small mark
//   public/apple-touch-icon.png   180 px app icon
//   public/icon-192.png / icon-512.png, public/site.webmanifest
//   public/logo.png               600 px stacked logo (search engines, JSON-LD)
//   public/brand/logo-email.png   horizontal logo for the booking emails (Gmail can't show SVG)
//   public/og.jpg                 1200×630 social share image
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import sharp from 'sharp';

const BRAND = 'public/brand';
const C = { blush100: '#F6E6E1', linen: '#FBF6F0', rose: '#A14D4B', cocoa: '#3B2A26' };
const svg = (name) => readFileSync(`${BRAND}/${name}.svg`);
const raster = (name, width, density = 1200) => sharp(svg(name), { density }).resize({ width });

// ── Favicons ────────────────────────────────────────────────────────────────
copyFileSync(`${BRAND}/logo-app-icon.svg`, 'public/favicon.svg');

const icoPngs = [];
for (const size of [16, 32, 48]) {
  // below 48 px the guide asks for the simplified mark, on the icon's blush tile
  const src = size < 48 ? 'logo-mark-small' : 'logo-app-icon';
  const inner = size < 48 ? Math.round(size * 0.86) : size;
  const mark = await raster(src, inner).png().toBuffer();
  const meta = await sharp(mark).metadata();
  const png = await sharp({ create: { width: size, height: size, channels: 4, background: size < 48 ? C.blush100 : { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, left: Math.round((size - meta.width) / 2), top: Math.round((size - meta.height) / 2) }])
    .png()
    .toBuffer();
  icoPngs.push({ size, png });
}
// ICO container with embedded PNGs
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(icoPngs.length, 4);
let offset = 6 + 16 * icoPngs.length;
const dir = [];
for (const { size, png } of icoPngs) {
  const e = Buffer.alloc(16);
  e.writeUInt8(size === 256 ? 0 : size, 0); e.writeUInt8(size === 256 ? 0 : size, 1);
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
  offset += png.length;
  dir.push(e);
}
writeFileSync('public/favicon.ico', Buffer.concat([header, ...dir, ...icoPngs.map((i) => i.png)]));

for (const [file, size] of [['public/apple-touch-icon.png', 180], ['public/icon-192.png', 192], ['public/icon-512.png', 512]]) {
  await raster('logo-app-icon', size).flatten({ background: C.blush100 }).png({ compressionLevel: 9 }).toFile(file);
}

writeFileSync(
  'public/site.webmanifest',
  JSON.stringify(
    {
      name: 'Blush Picnic',
      short_name: 'Blush Picnic',
      description: 'Luxury picnic setups in Toronto & the GTA',
      start_url: '/',
      display: 'browser',
      background_color: C.blush100,
      theme_color: C.blush100,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
    },
    null,
    2,
  ) + '\n',
);

// ── Logos as images ─────────────────────────────────────────────────────────
await raster('logo-stacked', 600).png({ compressionLevel: 9 }).toFile('public/logo.png');
await raster('logo-horizontal', 560).flatten({ background: C.linen }).png({ compressionLevel: 9 }).toFile(`${BRAND}/logo-email.png`);

// ── Social share image (1200×630): primary logo on linen, inside the guide's clear space ──
const W = 1200, H = 630;
const logo = await raster('logo-stacked', 640).png().toBuffer();
const lm = await sharp(logo).metadata();
const frame = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="100%" height="100%" fill="${C.linen}"/>
  <rect x="28" y="28" width="${W - 56}" height="${H - 56}" rx="26" fill="none" stroke="${C.blush100}" stroke-width="8"/>
</svg>`);
await sharp(frame)
  .composite([{ input: logo, left: Math.round((W - lm.width) / 2), top: Math.round((H - lm.height) / 2) }])
  .jpeg({ quality: 86, mozjpeg: true })
  .toFile('public/og.jpg');

console.log('Brand images written: favicon.svg/.ico, apple-touch-icon, icon-192/512, site.webmanifest, logo.png, brand/logo-email.png, og.jpg');
