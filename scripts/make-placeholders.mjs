// Generates soft, on-brand placeholder photos in src/assets/photos/.
// They are clearly labelled "Placeholder" so nobody mistakes them for real work.
// Real photos replace them via `npm run photos` (see HANDOVER.md).
//
// Usage: node scripts/make-placeholders.mjs [--force]
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const OUT = 'src/assets/photos';
const force = process.argv.includes('--force');
mkdirSync(OUT, { recursive: true });

// [file, width, height, label, tint]
// Brand palette (Logo Guide): Blush 100/300/500, Sage, Linen, Gold
const tints = {
  blush: ['#F6E6E1', '#EFC7C0'],
  rose: ['#F3DCD6', '#E3A6A0'],
  sage: ['#EEF1EA', '#C7D3C3'],
  cream: ['#FBF6F0', '#F0E2D2'],
  plum: ['#F4E3DE', '#E8BDB6'],
  gold: ['#FAF1E4', '#E6CFA6'],
};

const occasions = [
  ['picnic-date', 'Picnic date', 'blush'],
  ['birthday', 'Birthday picnic', 'gold'],
  ['anniversary', 'Anniversary picnic', 'rose'],
  ['be-my-girlfriend', 'Be My Girlfriend picnic', 'rose'],
  ['proposal', 'Proposal picnic', 'blush'],
  ['just-engaged', 'Engagement picnic', 'gold'],
  ['newly-married', 'Newlywed picnic', 'cream'],
  ['family', 'Family picnic', 'sage'],
  ['appreciation', 'Appreciation picnic', 'cream'],
  ['retirement', 'Retirement picnic', 'sage'],
  ['new-baby', 'Welcome baby picnic', 'cream'],
  ['gender-reveal', 'Gender reveal picnic', 'plum'],
  ['baby-shower', 'Baby shower picnic', 'sage'],
  ['announcement', 'Pregnancy announcement', 'blush'],
  ['bridal-shower', 'Bridal shower picnic', 'rose'],
  ['corporate', 'Team & corporate picnic', 'sage'],
];

const images = [
  ['hero.jpg', 1600, 2000, 'Hero — styled picnic setup', 'blush'],
  ['about.jpg', 1600, 2000, 'About — owner photo', 'cream'],
  ['pkg-signature.jpg', 1600, 1200, 'Signature Picnic', 'blush'],
  ['pkg-proposal-romance.jpg', 1600, 1200, 'Proposal & Romance', 'rose'],
  ['pkg-celebration.jpg', 1600, 1200, 'Celebration', 'gold'],
  ['step-1.jpg', 1200, 900, 'Planning your picnic', 'sage'],
  ['step-2.jpg', 1200, 900, 'We set up', 'cream'],
  ['step-3.jpg', 1200, 900, 'You arrive', 'blush'],
  ...occasions.map(([id, label, tint]) => [`occasion-${id}.jpg`, 1600, 2000, label, tint]),
];

// Gallery: varied aspect ratios so the masonry grid looks natural.
const ratios = [
  [1200, 1500],
  [1200, 900],
  [1200, 1200],
  [1200, 1600],
  [1200, 800],
];
occasions.forEach(([id, label, tint], i) => {
  for (let n = 1; n <= 2; n++) {
    const [w, h] = ratios[(i * 2 + n) % ratios.length];
    images.push([`gallery-${id}-${n}.jpg`, w, h, `${label} ${n}`, tint]);
  }
});

function svg(w, h, label, [a, b]) {
  const archW = Math.round(w * 0.42);
  const archH = Math.round(Math.min(h * 0.62, archW * 1.45));
  const x = Math.round((w - archW) / 2);
  const y = Math.round((h - archH) / 2 - h * 0.03);
  const r = archW / 2;
  const fs = Math.round(Math.max(26, w * 0.026));
  const safe = label.replace(/&/g, '&amp;');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.35" r="0.6">
      <stop offset="0" stop-color="#FFFDFC" stop-opacity="0.55"/><stop offset="1" stop-color="#FFFDFC" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <path d="M ${x} ${y + archH} L ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + archW} ${y + r} L ${x + archW} ${y + archH}"
        fill="none" stroke="#C49A5A" stroke-opacity="0.75" stroke-width="${Math.max(2, w * 0.002)}"/>
  <text x="50%" y="${y + archH + fs * 2.2}" text-anchor="middle" font-family="sans-serif" font-size="${fs}"
        fill="#3B2A26" fill-opacity="0.62" letter-spacing="1">Placeholder · ${safe}</text>
</svg>`;
}

let made = 0;
for (const [file, w, h, label, tint] of images) {
  const out = join(OUT, file);
  if (existsSync(out) && !force) continue;
  await sharp(Buffer.from(svg(w, h, label, tints[tint])))
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(out);
  made++;
}
console.log(`Placeholders: ${made} created, ${images.length - made} already present (use --force to regenerate).`);
