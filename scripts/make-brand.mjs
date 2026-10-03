// Generates every Blush Picnic brand asset from the Gloock typeface, with the lettering converted
// to outlined paths so the logo renders identically everywhere (no font loading, no fallbacks).
//
//   node scripts/make-brand.mjs
//
// Writes (all deterministic — same inputs, same bytes):
//   public/logo.svg              plum wordmark (#3B1730), for documents and anywhere an <img> is needed
//   public/logo.png              1200px transparent PNG of the wordmark (JSON-LD "logo")
//   public/favicon.svg           "B" monogram in a petal arch (readable at 16px, light and dark tabs)
//   public/favicon.ico           16/32/48px PNGs wrapped in an ICO container
//   public/apple-touch-icon.png  180×180, petal background
//   public/icon-192.png, icon-512.png   manifest icons (maskable-safe)
//   public/site.webmanifest
//   public/og.jpg                1200×630 social share image (< 200 KB)
//   src/components/Wordmark.astro   only the block between the "brand:start/end" markers
//                                   (the inline, currentColor version of the same outlines)
//
// The name and tagline are read from src/content/settings.yaml, so re-run this script after
// changing either. Signature detail: the dots of the i's are tiny arches — the site's one motif.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as opentypeModule from 'opentype.js';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const at = (...p) => join(ROOT, ...p);
mkdirSync(PUBLIC, { recursive: true });

// ───────────────────────── Brand constants ─────────────────────────
const C = {
  plum: '#3B1730',
  plumSoft: '#6B4A60',
  petal: '#F6E4E1',
  petalDeep: '#EFD3CE',
  cream: '#FFFDFC',
  gold: '#C9A45C',
  line: '#E6CDC8',
};

const settings = readFileSync(at('src/content/settings.yaml'), 'utf8');
const yamlString = (key, fallback) => settings.match(new RegExp(`^\\s*${key}:\\s*"([^"]*)"`, 'm'))?.[1] ?? fallback;
const NAME = yamlString('name', 'Blush Picnic');
const TAGLINE = yamlString('tagline', 'Luxury picnic setups in Toronto & the GTA');
const DESCRIPTION = yamlString('description', TAGLINE);
const DOMAIN = yamlString('domain', 'blushpicnic.com');

// Wordmark typography (font units, 1000 per em)
const WORDMARK = {
  tracking: 32, // Gloock is spaced for text; a logo needs a little more air, especially at 22px
  wordSpace: 225, // default space is 215; a touch wider to balance the extra tracking
  archDot: { width: 140, height: 186, bottom: 606 }, // replaces Gloock's round i-dot (76–241 × 609–775)
};

// ───────────────────────── Font helpers ─────────────────────────
// opentype.js resolves to its UMD build under Node, so the API may sit on .default
const opentype = opentypeModule.parse ? opentypeModule : opentypeModule.default;

function loadOpentype(path) {
  const buf = readFileSync(path);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const gloock = loadOpentype(at('node_modules/@fontsource/gloock/files/gloock-latin-400-normal.woff'));

/** Round to at most `dp` decimals, without trailing zeros. */
const num = (n, dp = 1) => {
  const r = Math.round(n * 10 ** dp) / 10 ** dp;
  return Object.is(r, -0) ? '0' : String(r);
};

/**
 * Serialise path commands as compact relative SVG path data.
 * Commands use opentype.js shape: {type, x, y, x1, y1, x2, y2}, already in SVG (y-down) space.
 */
function pathData(cmds, dp = 1) {
  let out = '';
  let cx = 0, cy = 0, sx = 0, sy = 0;
  // Work in rounded absolute coordinates so relative deltas never accumulate rounding error.
  const R = (v) => Math.round(v * 10 ** dp) / 10 ** dp;
  const d = (v) => num(v, dp);
  const pair = (x, y) => `${d(x)} ${d(y)}`;
  for (const c of cmds) {
    switch (c.type) {
      case 'M': {
        const x = R(c.x), y = R(c.y);
        out += out ? `m${pair(x - cx, y - cy)}` : `M${pair(x, y)}`;
        cx = sx = x; cy = sy = y;
        break;
      }
      case 'L': {
        const x = R(c.x), y = R(c.y);
        if (x === cx && y === cy) break; // zero-length segment
        if (y === cy) out += `h${d(x - cx)}`;
        else if (x === cx) out += `v${d(y - cy)}`;
        else out += `l${pair(x - cx, y - cy)}`;
        cx = x; cy = y;
        break;
      }
      case 'Q': {
        const x1 = R(c.x1), y1 = R(c.y1), x = R(c.x), y = R(c.y);
        out += `q${pair(x1 - cx, y1 - cy)} ${pair(x - cx, y - cy)}`;
        cx = x; cy = y;
        break;
      }
      case 'C': {
        const x1 = R(c.x1), y1 = R(c.y1), x2 = R(c.x2), y2 = R(c.y2), x = R(c.x), y = R(c.y);
        out += `c${pair(x1 - cx, y1 - cy)} ${pair(x2 - cx, y2 - cy)} ${pair(x - cx, y - cy)}`;
        cx = x; cy = y;
        break;
      }
      case 'A': {
        // custom: {type:'A', r, sweep, x, y}
        const x = R(c.x), y = R(c.y);
        out += `a${d(c.r)} ${d(c.r)} 0 0 ${c.sweep} ${pair(x - cx, y - cy)}`;
        cx = x; cy = y;
        break;
      }
      case 'Z':
        out += 'z';
        cx = sx; cy = sy;
        break;
    }
  }
  // tidy: "1 -2" -> "1-2", "0.5" -> ".5"
  return out
    .replace(/(^|[^\d])0\./g, '$1.')
    .replace(/ -/g, '-');
}

/** Split a command list into closed contours. */
function contours(cmds) {
  const list = [];
  let cur = [];
  for (const c of cmds) {
    if (c.type === 'M' && cur.length) {
      list.push(cur);
      cur = [];
    }
    cur.push(c);
  }
  if (cur.length) list.push(cur);
  return list;
}

const bounds = (cmds) => {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const c of cmds) {
    for (const [kx, ky] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']]) {
      if (c[kx] === undefined) continue;
      x1 = Math.min(x1, c[kx]); x2 = Math.max(x2, c[kx]);
      y1 = Math.min(y1, c[ky]); y2 = Math.max(y2, c[ky]);
    }
  }
  return { x1, y1, x2, y2 };
};

/** A small arch (flat base, semicircular top) as path commands, y-down space. */
function archShape(cx, bottom, width, height) {
  const r = width / 2;
  const shoulder = bottom - (height - r);
  return [
    { type: 'M', x: cx - r, y: bottom },
    { type: 'L', x: cx - r, y: shoulder },
    { type: 'A', r, sweep: 1, x: cx + r, y: shoulder },
    { type: 'L', x: cx + r, y: bottom },
    { type: 'Z' },
  ];
}

/**
 * Lay out a line of Gloock text as outlined commands in font units (y-down, baseline at y=0).
 * Uses the font's GPOS kerning plus optional tracking; replaces i-dots with arches when asked.
 */
function setGloock(text, { tracking = 0, wordSpace, archDots = false } = {}) {
  const font = gloock;
  const chars = [...text];
  const glyphs = chars.map((ch) => font.charToGlyph(ch));
  const cmds = [];
  let x = 0;
  glyphs.forEach((g, i) => {
    const ch = chars[i];
    let glyphCmds = g.getPath(x, 0, font.unitsPerEm).commands;
    if (archDots && ch === 'i') {
      const parts = contours(glyphCmds);
      // the dot is the contour that sits highest (smallest y in y-down space)
      const dotIndex = parts.reduce((best, p, idx) => (bounds(p).y1 < bounds(parts[best]).y1 ? idx : best), 0);
      const dot = bounds(parts[dotIndex]);
      const { width, height, bottom } = WORDMARK.archDot;
      parts.splice(dotIndex, 1, archShape((dot.x1 + dot.x2) / 2, -bottom, width, height));
      glyphCmds = parts.flat();
    }
    cmds.push(...glyphCmds);
    let adv = ch === ' ' && wordSpace != null ? wordSpace : g.advanceWidth;
    if (i < glyphs.length - 1) adv += font.getKerningValue(g, glyphs[i + 1]) + (ch === ' ' || chars[i + 1] === ' ' ? 0 : tracking);
    x += adv;
  });
  return { cmds, width: x, bounds: bounds(cmds) };
}

/** Translate + scale commands (uniform scale, applied after translating). */
function transform(cmds, { dx = 0, dy = 0, s = 1 }) {
  return cmds.map((c) => {
    const o = { ...c };
    for (const [kx, ky] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']]) {
      if (o[kx] !== undefined) {
        o[kx] = (o[kx] + dx) * s;
        o[ky] = (o[ky] + dy) * s;
      }
    }
    if (o.r !== undefined) o.r *= s;
    return o;
  });
}

// Figtree (the site's body face) for small supporting text on the share image. It only ships as a
// variable WOFF2, which opentype.js can't read; fontkitten (bundled with Astro) can. Its default
// instance is the Light master, so the text is drawn with a hairline stroke to reach ~Regular.
// If fontkitten is ever unavailable, the supporting text falls back to Gloock.
let figtree = null;
try {
  const { create } = await import('fontkitten');
  figtree = create(readFileSync(at('node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2')));
} catch {
  console.warn('! fontkitten not available — og.jpg supporting text falls back to Gloock');
}

// Hand kerning for the few Figtree pairs that need it (fontkitten has no GPOS layout).
const FIGTREE_KERN = { To: -45, TA: -40, GT: -20, Ty: -40, Te: -40, ry: -10, 'y ': -10 };

function setFigtree(text, { tracking = 0 } = {}) {
  if (!figtree) {
    const g = setGloock(text, { tracking });
    return { ...g, stroke: 0 };
  }
  const chars = [...text];
  const cmds = [];
  let x = 0;
  chars.forEach((ch, i) => {
    const g = figtree.glyphForCodePoint(ch.codePointAt(0));
    for (const { command, args } of g.path.commands) {
      // fontkitten: y-up font units → y-down
      const P = (k) => ({ x: x + args[k], y: -args[k + 1] });
      switch (command) {
        case 'moveTo': cmds.push({ type: 'M', ...P(0) }); break;
        case 'lineTo': cmds.push({ type: 'L', ...P(0) }); break;
        case 'quadraticCurveTo': {
          const c1 = P(0), p = P(2);
          cmds.push({ type: 'Q', x1: c1.x, y1: c1.y, x: p.x, y: p.y });
          break;
        }
        case 'bezierCurveTo': {
          const c1 = P(0), c2 = P(2), p = P(4);
          cmds.push({ type: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: p.x, y: p.y });
          break;
        }
        case 'closePath': cmds.push({ type: 'Z' }); break;
      }
    }
    x += g.advanceWidth + (i < chars.length - 1 ? (FIGTREE_KERN[ch + chars[i + 1]] ?? 0) + tracking : 0);
  });
  return { cmds, width: x, bounds: bounds(cmds), stroke: 1 };
}

// ───────────────────────── Wordmark ─────────────────────────
const word = setGloock(NAME, { tracking: WORDMARK.tracking, wordSpace: WORDMARK.wordSpace, archDots: true });
// Tight box around the ink, with a hair of padding so anti-aliasing never clips.
const PAD = 6;
const wb = word.bounds;
const wmCmds = transform(word.cmds, { dx: -wb.x1 + PAD, dy: -wb.y1 + PAD });
const WM_W = Math.ceil(wb.x2 - wb.x1 + PAD * 2);
const WM_H = Math.ceil(wb.y2 - wb.y1 + PAD * 2);
const WM_D = pathData(wmCmds, 0);
const WM_BASELINE = -wb.y1 + PAD; // y of the baseline inside the viewBox

const svgDoc = (w, h, body, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"${extra}>${body}</svg>\n`;

// Intrinsic size 60px tall (scales freely); plum fill for use as an <img> or in documents.
const LOGO_H = 60;
const logoSvg = svgDoc(
  WM_W,
  WM_H,
  `<title>${NAME}</title><path fill="${C.plum}" d="${WM_D}"/>`,
  ` width="${num((LOGO_H * WM_W) / WM_H)}" height="${LOGO_H}" role="img" aria-label="${NAME}"`,
);
writeFileSync(at('public/logo.svg'), logoSvg);

// logo.png — 1200px wide, transparent, small margin
{
  const W = 1200;
  const margin = 40;
  const s = (W - margin * 2) / WM_W;
  const H = Math.round(WM_H * s + margin * 2);
  const body = `<path fill="${C.plum}" transform="translate(${margin} ${margin}) scale(${s})" d="${WM_D}"/>`;
  await sharp(Buffer.from(svgDoc(W, H, body, ` width="${W}" height="${H}"`)))
    .png({ compressionLevel: 9, palette: false })
    .toFile(at('public/logo.png'));
}

// ───────────────────────── Monogram ─────────────────────────
// "B" from Gloock inside an arch. All measurements are ratios of the icon size.
//   arch:   { width, top, bottom (>= 1 runs off the bottom edge), fill?, stroke?, strokeWidth?, halo? }
//   letter: { height (cap height), baseline, fill, embolden (stroke width, thickens hairlines) }
const B = setGloock('B');
function monogram({ size, bg, arch, letter }) {
  const bb = B.bounds; // y-down, baseline 0
  const s = (letter.height * size) / (bb.y2 - bb.y1);
  const bw = (bb.x2 - bb.x1) * s;
  // Gloock's B carries more weight in its lower bowl; nudge it a hair left to sit optically centred
  const x = (size - bw) / 2 - bb.x1 * s - size * 0.004;
  const letterD = pathData(transform(B.cmds, { s }), 2);

  const aw = arch.width * size;
  const ax = (size - aw) / 2;
  const r = aw / 2;
  const top = arch.top * size;
  const runsOff = arch.bottom >= 1;
  const bottom = runsOff ? size + 1 : arch.bottom * size;
  const archPath = (inset = 0) =>
    `M${num(ax - inset, 2)} ${num(bottom, 2)}V${num(top + r, 2)}a${num(r + inset, 2)} ${num(r + inset, 2)} 0 0 1 ${num(aw + inset * 2, 2)} 0V${num(bottom, 2)}`;
  const archD = archPath();

  let body = '';
  if (bg) body += `<rect width="${size}" height="${size}" fill="${bg}"/>`;
  if (arch.halo) {
    // a fine line just outside the arch, like the site's .arch-outline
    body += `<path fill="none" stroke="${arch.halo.color}" stroke-width="${num(arch.halo.width * size, 2)}" d="${archPath(arch.halo.offset * size)}"/>`;
  }
  if (arch.fill) body += `<path fill="${arch.fill}" d="${archD}z"/>`;
  if (arch.stroke) body += `<path fill="none" stroke="${arch.stroke}" stroke-width="${num(arch.strokeWidth * size, 2)}" d="${archD}${runsOff ? '' : 'z'}"/>`;
  const stroke = letter.embolden ? ` stroke="${letter.fill}" stroke-width="${num(letter.embolden * size, 3)}" stroke-linejoin="round"` : '';
  body += `<path fill="${letter.fill}"${stroke} transform="translate(${num(x, 2)} ${num(letter.baseline * size, 2)})" d="${letterD}"/>`;
  return svgDoc(size, size, body);
}

// favicon.svg: a petal arch (gives the mark an edge on dark browser tabs) holding a plum B.
const faviconSvg = monogram({
  size: 64,
  arch: { width: 1, top: 0, bottom: 1, fill: C.petal },
  letter: { height: 0.52, baseline: 0.845, fill: C.plum, embolden: 0.017 }, // embolden: keeps hairlines alive at 16px
});
writeFileSync(at('public/favicon.svg'), faviconSvg);

// Touch / manifest icons: full-bleed petal, a cream arch doorway with a fine gold line (the site's
// .arch-outline), the plum B inside.
// Everything sits inside the central 80% circle, so the 512px icon is also a valid maskable icon.
const appIconSvg = (size) => monogram(APP_ICON(size));
const APP_ICON = (size) => ({
  size,
  bg: C.petal,
  arch: { width: 0.54, top: 0.17, bottom: 1, fill: C.cream, halo: { offset: 0.038, width: 0.007, color: C.gold } },
  letter: { height: 0.29, baseline: 0.7, fill: C.plum, embolden: 0.003 },
});

const png = (svg, size) => sharp(Buffer.from(svg), { density: 72 * (size / 64) }).resize(size, size).png({ compressionLevel: 9 });

await png(appIconSvg(180), 180).toFile(at('public/apple-touch-icon.png'));
await png(appIconSvg(192), 192).toFile(at('public/icon-192.png'));
await png(appIconSvg(512), 512).toFile(at('public/icon-512.png'));

// favicon.ico — an ICO container holding PNG images (supported by every current browser).
{
  const sizes = [16, 32, 48];
  const images = [];
  for (const size of sizes) images.push(await png(faviconSvg, size).toBuffer());
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  images.forEach((data, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(sizes[i] % 256, 0); // width (0 = 256)
    e.writeUInt8(sizes[i] % 256, 1); // height
    e.writeUInt8(0, 2); // palette colours
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  });
  writeFileSync(at('public/favicon.ico'), Buffer.concat([header, ...entries, ...images]));
}

// ───────────────────────── Web manifest ─────────────────────────
writeFileSync(
  at('public/site.webmanifest'),
  JSON.stringify(
    {
      id: '/',
      name: NAME,
      short_name: NAME,
      description: DESCRIPTION,
      lang: 'en-CA',
      start_url: '/',
      scope: '/',
      display: 'minimal-ui',
      background_color: C.petal,
      theme_color: C.petal,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  ) + '\n',
);

// ───────────────────────── Share image ─────────────────────────
{
  const W = 1200, H = 630;
  // A cream arch rising from the bottom edge, framed by a fine gold line (like .arch-outline).
  const archW = 860;
  const archTop = 74;
  const ax = (W - archW) / 2;
  const r = archW / 2;
  const arch = (inset) => {
    const x0 = ax - inset, w = archW + inset * 2, rr = r + inset, t = archTop - inset;
    return `M${x0} ${H + 2}V${t + rr}a${rr} ${rr} 0 0 1 ${w} 0V${H + 2}`;
  };

  // Wordmark
  // ≤ 580px wide so the name survives apps that crop share images to a centred square
  const wmWidth = 570;
  const ws = wmWidth / WM_W;
  const wmX = (W - wmWidth) / 2;
  const wmBaseline = 322;
  const wmY = wmBaseline - WM_BASELINE * ws;

  // Tagline + domain in Figtree
  const tag = setFigtree(TAGLINE, { tracking: 6 });
  const tagSize = 30;
  const ts = tagSize / 1000;
  const tagW = tag.width * ts;
  const tagX = (W - tagW) / 2;
  const tagBaseline = 406;

  const dom = setFigtree(DOMAIN, { tracking: 40 });
  const domSize = 21;
  const dsc = domSize / 1000;
  const domW = dom.width * dsc;
  const domX = (W - domW) / 2;
  const domBaseline = 556;

  const textPath = (set, s, x, y, fill, strokeUnits) => {
    const stroke = set.stroke ? ` stroke="${fill}" stroke-width="${num(strokeUnits, 1)}" stroke-linejoin="round"` : '';
    return `<path fill="${fill}"${stroke} transform="translate(${num(x, 2)} ${num(y, 2)}) scale(${num(s, 5)})" d="${pathData(set.cmds, 0)}"/>`;
  };

  const body = [
    `<rect width="${W}" height="${H}" fill="${C.petal}"/>`,
    `<path d="${arch(0)}z" fill="${C.cream}"/>`,
    `<path d="${arch(18)}" fill="none" stroke="${C.gold}" stroke-width="1.6"/>`,
    `<path fill="${C.plum}" transform="translate(${num(wmX, 2)} ${num(wmY, 2)}) scale(${num(ws, 5)})" d="${WM_D}"/>`,
    // short gold rule between the name and the line
    `<path d="M${W / 2 - 22} 360.5h44" stroke="${C.gold}" stroke-width="1.5"/>`,
    textPath(tag, ts, tagX, tagBaseline, C.plum, 22),
    textPath(dom, dsc, domX, domBaseline, C.plumSoft, 18),
  ].join('');

  await sharp(Buffer.from(svgDoc(W, H, body, ` width="${W}" height="${H}"`)))
    .flatten({ background: C.petal })
    .jpeg({ quality: 86, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toFile(at('public/og.jpg'));
}

// ───────────────────────── Wordmark.astro data block ─────────────────────────
{
  const file = at('src/components/Wordmark.astro');
  const src = readFileSync(file, 'utf8');
  const block =
    `// brand:start — generated by scripts/make-brand.mjs, do not edit by hand\n` +
    `const VIEW_W = ${WM_W};\n` +
    `const VIEW_H = ${WM_H};\n` +
    `const D = '${WM_D}';\n` +
    `// brand:end`;
  const next = src.replace(/\/\/ brand:start[\s\S]*?\/\/ brand:end/, block);
  if (next === src && !src.includes(block)) {
    console.warn('! Wordmark.astro has no brand:start/brand:end markers — skipped');
  } else {
    writeFileSync(file, next);
  }
}

console.log(`Brand assets written. Wordmark viewBox ${WM_W}×${WM_H} (${(WM_W / WM_H).toFixed(3)}:1), path ${WM_D.length} chars.`);
