#!/usr/bin/env node
// Generate the site's stand-in photos with xAI's Grok image API, until real event photos exist.
//
//   XAI_API_KEY=… node scripts/ai-photos.mjs                    every photo not generated yet
//   XAI_API_KEY=… node scripts/ai-photos.mjs --only hero.jpg,occasion-*.jpg
//   XAI_API_KEY=… node scripts/ai-photos.mjs --force            regenerate everything
//   node scripts/ai-photos.mjs --dry-run                         list the prompts, call nothing
//
// Or without a computer: GitHub → Actions → "Generate AI photos" (needs the XAI_API_KEY
// repository secret). The key is read from the environment only — never put it in a file here.
//
// Each photo replaces the file of the same name in src/assets/photos/, cropped to that file's
// current proportions so the layout doesn't change. src/assets/photos/ai-photos.json records
// which photos are AI-generated (and from which prompt), so a re-run skips them.
//
// These are illustrations, not photos of real Blush Picnic events: the site labels them as AI
// illustrations (alt text, gallery note). Never generate the About photo (it must be the owner),
// and replace these with real photos via `npm run photos` as soon as they exist.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const DIR = 'src/assets/photos';
const LOG = path.join(DIR, 'ai-photos.json');
const API = process.env.XAI_API_BASE || 'https://api.x.ai/v1'; // override only for tests
const QUALITY = 82;
const PARALLEL = 3;

// Shared look for every image: the Logo Guide palette, no people (no invented clients),
// no text (models garble it), nothing the policies rule out (alcohol, confetti in parks).
const STYLE =
  'Photorealistic editorial lifestyle photograph for a luxury picnic styling company. ' +
  'Soft natural light, shallow depth of field, gentle film grain, refined, airy and calm. ' +
  'Colour palette: blush pink, dusty rose, cream, linen white, sage green, warm gold accents, light oak wood. ' +
  'No people, no hands, no faces, no text, no lettering, no signs, no logos, no watermark, no alcohol bottles, no confetti.';

// [file, prompt] — the scene only; STYLE is appended.
const HERO = [
  ['hero.jpg', 'A luxury styled picnic on green grass in a Toronto park at golden hour, the CN Tower softly out of focus in the distance. A low light-oak table with a cream linen runner, low arrangements of blush and dusty-rose roses, gold-rimmed glassware, ceramic plates, linen napkins and small candles. Blush, cream and sage velvet floor cushions on a large neutral rug, a woven rattan basket, pampas grass and a soft pink parasol.'],
];

const PACKAGES = [
  ['pkg-signature.jpg', 'An elegant picnic for two on green grass in a leafy Toronto park in late afternoon light. A low light-oak table with a cream linen runner, a low arrangement of blush and cream roses, two ceramic place settings, a glass carafe of sparkling lemonade, a small charcuterie board, taper candles. Two blush and cream velvet floor cushions on a jute rug, a rattan basket and a cream parasol.'],
  ['pkg-proposal-romance.jpg', 'A romantic proposal picnic at sunset on a grassy waterfront park by Lake Ontario, Toronto skyline far in the background. A tall arch covered in blush, white and dusty-rose roses, a low table for two with a cream cloth, gold-rimmed glassware, many pillar candles in glass lanterns, a path of rose petals leading to blush velvet cushions on a cream rug.'],
  ['pkg-celebration.jpg', 'A luxury group picnic for eight in a sunny Toronto park. A long low light-oak table with a cream linen runner, blush and cream florals, gold cutlery, ceramic plates, a small two-tier cake with fresh flowers, pastries and fruit platters. Blush, cream and sage velvet floor cushions along both sides on large rugs, an organic balloon garland in blush, cream, sage and gold behind the table, pampas grass.'],
];

// occasion id → [occasion hero, gallery 1 (another setting), gallery 2 (close-up detail)]
const OCCASIONS = {
  'picnic-date': [
    'An intimate picnic date for two on a quiet sandy beach in Toronto at golden hour, calm lake behind. A low wooden table with cream linen, a small vase of blush peonies, plates of strawberries and macarons, a glass carafe of pink lemonade, two blush velvet cushions on a cream rug, a rattan basket and candle lanterns.',
    'A picnic for two under a large maple tree in a city park, dappled afternoon light. A low table with blush florals, a cream parasol, two velvet cushions on a neutral rug, a woven basket and a light throw blanket.',
    'Close-up detail of a picnic table for two: blush napkins tied with silk ribbon, gold cutlery, ceramic plates with fresh berries, small bud vases with garden roses, soft bokeh of green grass behind.',
  ],
  birthday: [
    'A birthday picnic in a green Toronto park. A low light-oak table with cream linen, a small white two-tier cake decorated with fresh blush flowers and thin gold candles, cupcakes, pastel macarons, wrapped gift boxes with silk ribbons. An organic balloon garland in blush, cream, gold and sage behind the table, velvet floor cushions on a rug, pampas grass.',
    'A birthday picnic in a sunny backyard: a long low table for six, a wooden arch backdrop with a balloon garland in blush, cream and gold, a cake stand with cupcakes, gift boxes, floor cushions on rugs.',
    'Close-up of a small white birthday cake decorated with fresh blush roses and thin gold candles on a glass cake stand, macarons and pastel plates around it.',
  ],
  anniversary: [
    'A romantic anniversary picnic in a backyard garden at dusk. A low table for two with a cream linen cloth, dusty-rose and blush roses, gold-rimmed glasses of sparkling juice, a box of chocolates, many candles in glass hurricanes, warm string lights overhead, blush velvet cushions on a cream rug, scattered rose petals.',
    'An anniversary picnic for two on a grassy bluff above Lake Ontario at sunset: a low table with deep rose and blush florals, candle lanterns, a cream throw and two velvet cushions.',
    'Close-up of an anniversary table: two gold-rimmed glasses of sparkling juice, chocolates, rose petals and a sealed cream envelope with a wax seal, in warm candlelight.',
  ],
  'be-my-girlfriend': [
    'A sweet romantic picnic for two in a Toronto park: a low table with a bouquet of red and blush roses, a cluster of heart-shaped balloons in blush and red tied beside the table, chocolate-dipped strawberries, a cream rug and velvet cushions, soft golden light.',
    'A romantic picnic for two at sunset with heart-shaped blush and red balloons, a plush teddy bear on a cushion, a bouquet of roses on the low table and candles in glass holders.',
    'Close-up of a hand-tied bouquet of red and blush roses lying on cream linen beside chocolate-dipped strawberries and a small gift box with a satin bow.',
  ],
  proposal: [
    'A proposal picnic at sunset on a grassy waterfront park in Toronto: a tall arch of blush, white and dusty-rose roses, a rose-petal path leading to a low table for two, many pillar candles in glass lanterns, blush velvet cushions on a cream rug.',
    'A proposal setup inside an elegant venue with tall arched windows: floor arrangements of white and blush roses, a cream rug, a low table for two and dozens of candles glowing warmly.',
    'Close-up of an open blush velvet ring box holding a diamond engagement ring, resting on cream linen among rose petals and flickering candles.',
  ],
  'just-engaged': [
    'An engagement celebration picnic in a Toronto park: a balloon garland in cream, champagne gold and blush, a long low table for eight with white and blush florals, a small white cake, coupe glasses of sparkling juice, velvet floor cushions.',
    'A just-engaged celebration picnic in a garden: a round arch framed in white florals and greenery, a low table with gold accents, cream cushions and pampas grass.',
    'Close-up of gold-rimmed coupe glasses of sparkling juice, a small white cake topped with fresh flowers, macarons and a cream linen napkin with a gold napkin ring.',
  ],
  'newly-married': [
    'An elegant newlywed picnic in a Toronto garden: white and cream florals with soft greenery, a small two-tier white cake, gold cutlery, cream linen, sage and cream velvet cushions and a lace parasol.',
    'A newlywed picnic for two on a lakeside lawn at golden hour: a low table with white roses and baby\'s breath, a cream parasol, white cushions and candles.',
    'Close-up of a small white cake with fresh white roses beside two gold-rimmed glasses and a lace napkin on a light-oak table.',
  ],
  family: [
    'A relaxed luxury family picnic in a leafy Toronto park: a long low table for six, sage, cream and blush cushions, fruit platters, mini sandwiches, a glass lemonade dispenser, a wicker basket and a frisbee on the rug, bright daylight.',
    'A family picnic in a spacious green backyard: a long low table with colourful fruit platters, sage and cream cushions, a cream canvas bell tent in the background.',
    'Close-up of kid-friendly picnic snack boxes with fruit, crackers and cookies, small juice bottles with paper straws, on a cream linen runner.',
  ],
  appreciation: [
    'An elegant appreciation tea-party picnic in a blooming garden: a low table with a floral porcelain teapot and teacups, a tiered stand of pastries and scones, blush and cream florals, a cream rug and cushions, soft morning light.',
    'A thank-you picnic for a small group in a park: a low table with white and blush florals, small wrapped gifts at each place setting, sage cushions and a cream parasol.',
    'Close-up of a tiered stand with scones, macarons and petit fours beside a porcelain teapot and teacups with blush roses.',
  ],
  retirement: [
    'A refined retirement celebration picnic in a mature Toronto garden: a long low table for eight with sage and cream linens, white and blush florals, grazing boards of cheese, fruit and bread, glass carafes of lemonade, velvet cushions, warm afternoon light.',
    'A relaxed retirement picnic by a quiet lake: a low table with garden flowers, a cream parasol, sage cushions and a wicker basket, late afternoon sun.',
    'Close-up of a generous grazing board with cheeses, grapes, figs, crackers and fresh herbs on a light-oak table with a sage linen napkin.',
  ],
  'new-baby': [
    'A soft welcome-baby picnic in a backyard: a low table with pastel florals, a balloon garland in cream, blush and sage, a plush teddy bear, a small cake, a knitted baby blanket folded on a cushion, gentle daylight.',
    'A welcome-baby picnic in a bright park: cream and sage cushions, a low table with white flowers, a wicker basket of gifts and a cream parasol.',
    'Close-up of tiny knitted baby booties beside a small bouquet of white and blush flowers and pastel macarons on cream linen.',
  ],
  'gender-reveal': [
    'A gender reveal picnic in a backyard: a balloon garland in soft pink, powder blue and cream, a low table with a white cake on a stand, pink and blue macarons, white florals and velvet cushions, bright daylight.',
    'A gender reveal picnic in a park: a large cream balloon beside a low table set for a small group, pink and blue florals, cupcakes and cushions on rugs.',
    'Close-up of a white cake on a stand surrounded by soft pink and powder-blue macarons and small white flowers.',
  ],
  'baby-shower': [
    'A baby shower picnic in a Toronto park: a long low table, a balloon garland in sage, cream and blush, cupcakes and petit fours, wrapped gifts, white florals, velvet cushions, soft light.',
    'A baby shower picnic in a garden: a low table for eight with sage linens, white roses, a tiered dessert stand and gift boxes stacked beside cream cushions.',
    'Close-up of cupcakes with sage and cream frosting, a small bouquet and tiny wrapped gifts tied with silk ribbon.',
  ],
  announcement: [
    'A pregnancy announcement picnic for two in a Toronto park at golden hour: a low table with blush florals, a pair of tiny white baby shoes placed on the table, soft blush balloons, a cream rug and velvet cushions.',
    'A picnic for two on a quiet beach with a small cluster of blush and cream balloons, a low table with flowers and a wicker basket.',
    'Close-up of tiny white knitted baby shoes on cream linen next to a small bouquet of blush flowers.',
  ],
  'bridal-shower': [
    'A bridal shower picnic in a garden: a long low table for ten with white and blush florals, a tiered pastry stand, macarons, a porcelain tea service, cream and blush cushions and a white balloon garland, elegant and bright.',
    'A bridal shower picnic in an elegant indoor venue with tall windows: a long low table with white roses, pearl details, blush cushions and candles.',
    'Close-up of a bridal shower table: white garden roses, macarons, a tiered cake stand, gold cutlery and pearl details.',
  ],
  corporate: [
    'A team picnic for twelve in a Toronto park with office towers softly in the background: a long low table with sage and cream linens, individually boxed gourmet lunches, fruit platters, glass dispensers of infused water and floor cushions, bright midday light.',
    'A corporate picnic on a green lawn: two long low tables with sage linens and white flowers, rows of cushions and cream parasols.',
    'Close-up of neatly arranged boxed gourmet lunches with sandwiches and salads on a sage linen runner, glass bottles of sparkling water.',
  ],
};

const JOBS = [
  ...HERO,
  ...PACKAGES,
  ...Object.entries(OCCASIONS).flatMap(([id, [hero, g1, g2]]) => [
    [`occasion-${id}.jpg`, hero],
    [`gallery-${id}-1.jpg`, g1],
    [`gallery-${id}-2.jpg`, g2],
  ]),
].map(([file, scene]) => ({ file, prompt: `${scene} ${STYLE}` }));

// ── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return '';
  return args[i].includes('=') ? args[i].split('=').slice(1).join('=') : args[i + 1] || '';
};
if (flag('--help') || flag('-h')) {
  console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').filter((l) => l.startsWith('//')).slice(0, 20).join('\n'));
  process.exit(0);
}
const force = flag('--force');
const dry = flag('--dry-run') || flag('-n');
const only = opt('--only')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`));

const log = existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : {};
// Real photos swapped in with `npm run photos` are listed here and are never overwritten, and a gallery
// photo is only made while its entry's file still exists (real photos remove the stand-in entries).
const REAL = path.join(DIR, 'real-photos.json');
const real = new Set(existsSync(REAL) ? JSON.parse(readFileSync(REAL, 'utf8')) : []);
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
// A logged file whose bytes changed was replaced by hand (e.g. uploaded on GitHub): it's real too.
for (const [file, meta] of Object.entries(log)) {
  const full = path.join(DIR, file);
  if (meta.sha256 && existsSync(full) && sha256(full) !== meta.sha256) real.add(file);
}
const wanted = (j) => !only.length || only.some((r) => r.test(j.file));
const protectedJobs = JOBS.filter((j) => wanted(j) && real.has(j.file));
if (protectedJobs.length) console.log(`Skipping real photos: ${protectedJobs.map((j) => j.file).join(', ')}`);
const todo = JOBS.filter(
  (j) =>
    wanted(j) &&
    !real.has(j.file) &&
    (!j.file.startsWith('gallery-') || existsSync(path.join(DIR, j.file))) &&
    (force || only.length || !log[j.file]),
);

if (!todo.length) {
  console.log('Nothing to do: every photo is generated already (use --force or --only to redo some).');
  process.exit(0);
}
if (dry) {
  for (const j of todo) console.log(`${j.file}\n  ${j.prompt}\n`);
  console.log(`${todo.length} photo(s) would be generated.`);
  process.exit(0);
}

const KEY = (process.env.XAI_API_KEY || '').trim();
if (!KEY) {
  console.error('XAI_API_KEY is not set. Run: XAI_API_KEY=… node scripts/ai-photos.mjs (or use the GitHub workflow).');
  process.exit(1);
}

// ── xAI API ─────────────────────────────────────────────────────────────────
async function api(pathname, body) {
  const res = await fetch(`${API}${pathname}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const err = new Error(`xAI ${res.status}: ${json.error?.message || json.error || json.raw || text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function pickModel() {
  if (process.env.XAI_IMAGE_MODEL?.trim()) return process.env.XAI_IMAGE_MODEL.trim();
  let ids = [];
  try {
    const r = await api('/image-generation-models');
    ids = (r.models || r.data || []).map((m) => m.id);
  } catch {
    try {
      ids = ((await api('/models')).data || []).map((m) => m.id).filter((id) => /image|imagine/.test(id));
    } catch { /* fall through */ }
  }
  const prefer = ['grok-imagine-image-pro', 'grok-imagine-image', 'grok-2-image-1212', 'grok-2-image'];
  const pick = prefer.find((p) => ids.includes(p)) || ids.find((id) => /imagine/.test(id)) || ids[0] || 'grok-2-image';
  console.log(`Image models on this key: ${ids.join(', ') || '(could not list)'} → using ${pick}`);
  return pick;
}

// Ratios the newer Grok Imagine models accept; the nearest one is requested, then cropped exactly.
const RATIOS = ['1:1', '3:4', '4:3', '2:3', '3:2', '9:16', '16:9', '1:2', '2:1'];
const nearestRatio = (w, h) =>
  RATIOS.map((r) => { const [a, b] = r.split(':').map(Number); return [r, Math.abs(Math.log(a / b) - Math.log(w / h))]; })
    .sort((x, y) => x[1] - y[1])[0][0];

let extrasOk = true; // turned off if the model rejects aspect_ratio / resolution
async function generate(model, prompt, ratio) {
  for (let attempt = 1; ; attempt++) {
    const body = { model, prompt, n: 1, response_format: 'b64_json' };
    if (extrasOk && /imagine/.test(model)) Object.assign(body, { aspect_ratio: ratio, resolution: '2k' });
    try {
      const r = await api('/images/generations', body);
      const item = r.data?.[0] || {};
      if (item.b64_json) return Buffer.from(item.b64_json, 'base64');
      if (item.url) {
        const img = await fetch(item.url, { signal: AbortSignal.timeout(120_000) });
        if (!img.ok) throw new Error(`download ${img.status}`);
        return Buffer.from(await img.arrayBuffer());
      }
      throw new Error('no image in the response');
    } catch (e) {
      if (e.status === 400 && extrasOk && /aspect|resolution|unknown|unrecognized|invalid/i.test(e.message)) {
        extrasOk = false;
        console.log('  (model ignores aspect_ratio/resolution — cropping instead)');
        continue;
      }
      if (e.status === 401 || e.status === 403) throw e;
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 4000 * attempt));
    }
  }
}

// Crop to the target's proportions (centre) and size it without enlarging.
async function save(buf, file, tw, th) {
  const img = sharp(buf).rotate();
  const { width: w, height: h } = await img.metadata();
  const target = tw / th;
  let cw = w, ch = Math.round(w / target);
  if (ch > h) { ch = h; cw = Math.round(h * target); }
  const scale = Math.min(1, tw / cw);
  await img
    .extract({ left: Math.round((w - cw) / 2), top: Math.round((h - ch) / 2), width: cw, height: ch })
    .resize(Math.round(cw * scale), Math.round(ch * scale))
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toFile(path.join(DIR, file));
  return [Math.round(cw * scale), Math.round(ch * scale), w, h];
}

const model = await pickModel();
let done = 0, failed = 0;
const queue = [...todo];
async function worker() {
  for (let job; (job = queue.shift()); ) {
    const out = path.join(DIR, job.file);
    // keep the current file's proportions (the placeholders were made at the intended sizes)
    const meta = existsSync(out) ? await sharp(out).metadata() : { width: 1600, height: 2000 };
    try {
      const buf = await generate(model, job.prompt, nearestRatio(meta.width, meta.height));
      const [w, h, sw, sh] = await save(buf, job.file, meta.width, meta.height);
      log[job.file] = { model, prompt: job.prompt, generated: new Date().toISOString().slice(0, 10), sha256: sha256(out) };
      writeFileSync(LOG, JSON.stringify(log, null, 2) + '\n');
      done++;
      console.log(`✓ ${job.file}  ${w}×${h} (from ${sw}×${sh})`);
    } catch (e) {
      failed++;
      console.error(`✗ ${job.file}: ${e.message}`);
      if (e.status === 401 || e.status === 403) { queue.length = 0; }
    }
  }
}
await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));
console.log(`\n${done} generated, ${failed} failed. Log: ${LOG}`);
if (failed) process.exit(1);
