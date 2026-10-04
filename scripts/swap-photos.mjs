#!/usr/bin/env node
// Swap the placeholder photos for real ones.
//
//   npm run photos -- ~/Desktop/blush-photos             replace photos
//   npm run photos -- ~/Desktop/blush-photos --dry-run   show what would happen, change nothing
//
// Put the photos in one folder, named like this (any of .jpg .jpeg .png .webp; capitals are fine):
//
//   hero.jpg                       big photo on the home page (also used on /links and /thank-you)
//   about.jpg                      About page: you, or your hands styling a setup
//   pkg-signature.jpg              Signature Picnic
//   pkg-proposal-romance.jpg       Proposal & Romance
//   pkg-celebration.jpg            Celebration
//   occasion-<id>.jpg              top photo of an occasion page, e.g. occasion-proposal.jpg
//   gallery/<id>/<any name>.jpg    gallery photos, one folder per occasion, e.g. gallery/birthday/IMG_2041.jpg
//
// <id> is an occasion's file name in src/content/occasions/ (proposal, birthday, baby-shower…);
// the page address or name works too (gallery/proposal-picnic-toronto, gallery/Be My Girlfriend).
//
// Every photo is turned upright, resized to at most 2400 px on its long side, saved as a
// high-quality JPEG, and stripped of ALL hidden data (camera, date, GPS location) before it is
// copied into src/assets/photos/. The build then makes the small AVIF/WebP versions visitors get.
//
// Gallery photos are added to src/content/gallery.yaml (your notes and comments there are kept).
// Once an occasion has a real photo, its "Placeholder" gallery images are removed.
// Afterwards the script lists the photo descriptions (alt text) to write: they are read aloud
// to blind visitors and help Google understand the photos.
//
// Options: --dry-run (-n)  change nothing · --root <dir>  another copy of the project · --help
import { existsSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import yaml from 'js-yaml';

const MAX_EDGE = 2400;
const QUALITY = 82;
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const HEIC_EXT = new Set(['.heic', '.heif']);
const IGNORE = /^(\.|thumbs\.db$|desktop\.ini$)/i;

// ── Arguments ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let dryRun = false;
let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let input = '';
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--dry-run' || a === '-n') dryRun = true;
  else if (a === '--root') root = path.resolve(args[++i] ?? '.');
  else if (a === '--help' || a === '-h') usage(0);
  else if (a.startsWith('-')) usage(1, `Unknown option ${a}`);
  else if (!input) input = a;
  else usage(1, `Only one folder please (got "${input}" and "${a}")`);
}
if (!input) usage(1, 'Which folder are the photos in?');
input = path.resolve(input.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
if (!existsSync(input) || !statSync(input).isDirectory()) usage(1, `Folder not found: ${input}`);

function usage(code, msg) {
  const text = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 24).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
  if (msg) console.error(`\n${msg}\n`);
  console.log(text);
  process.exit(code);
}

const PHOTOS = path.join(root, 'src/assets/photos');
const GALLERY_YAML = path.join(root, 'src/content/gallery.yaml');
const OCCASIONS_DIR = path.join(root, 'src/content/occasions');
const rel = (p) => path.relative(root, p) || '.';
for (const p of [PHOTOS, GALLERY_YAML, OCCASIONS_DIR]) if (!existsSync(p)) usage(1, `Not a Blush Picnic project (missing ${rel(p)}). Run it from the project folder.`);

// ── What the site has: occasions and photo slots ─────────────────────────────
const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const occasions = new Map(); // id → { id, name, file, data }
const alias = new Map(); // anything the owner might call it → id
for (const file of readdirSync(OCCASIONS_DIR).filter((f) => f.endsWith('.md')).sort()) {
  const id = file.slice(0, -3);
  const text = readFileSync(path.join(OCCASIONS_DIR, file), 'utf8');
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const data = fm ? yaml.load(fm[1]) ?? {} : {};
  occasions.set(id, { id, name: data.name ?? id, file: path.join(OCCASIONS_DIR, file), data });
}
for (const o of occasions.values()) {
  for (const key of [o.data.chip, o.data.name, o.data.urlSlug, o.id]) if (key && !alias.has(slugify(key))) alias.set(slugify(key), o.id);
  alias.set(o.id, o.id);
}
const occasionId = (s) => alias.get(slugify(s));
const occasionList = () => [...occasions.keys()].join(', ');

// Slots = every photo in src/assets/photos except gallery ones (hero, about, pkg-*, occasion-*, step-*…).
const slots = new Set(readdirSync(PHOTOS).filter((f) => f.endsWith('.jpg') && !f.startsWith('gallery-')).map((f) => f.slice(0, -4)));

// ── Read the owner's folder ──────────────────────────────────────────────────
const jobs = []; // { kind: 'slot'|'gallery', src, slot?, occasion? }
const skipped = []; // [file, reason]
const ext = (f) => path.extname(f).toLowerCase();
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function checkImageFile(full) {
  const e = ext(full);
  if (HEIC_EXT.has(e))
    return 'HEIC (iPhone format) can’t be read here. Export it as JPEG first: on a Mac open it in Preview → File → Export → JPEG; on iPhone, Settings → Camera → Formats → Most Compatible for future photos.';
  if (!IMAGE_EXT.has(e)) return 'not a photo this tool reads (use .jpg, .jpeg, .png or .webp)';
  return '';
}

const seenSlots = new Map();
for (const entry of readdirSync(input, { withFileTypes: true }).sort((a, b) => natural(a.name, b.name))) {
  if (IGNORE.test(entry.name)) continue;
  const full = path.join(input, entry.name);
  if (entry.isDirectory()) {
    if (entry.name.toLowerCase() === 'gallery') readGallery(full);
    else skipped.push([rel2(full), 'folders other than "gallery" are ignored']);
    continue;
  }
  const problem = checkImageFile(full);
  if (problem) { skipped.push([rel2(full), problem]); continue; }
  let base = path.basename(entry.name, path.extname(entry.name)).toLowerCase().trim().replace(/[\s_]+/g, '-');
  const occ = base.match(/^occasion-(.+)$/);
  if (occ) {
    const id = occasionId(occ[1]);
    if (!id) { skipped.push([rel2(full), `no occasion called "${occ[1]}". Use one of: ${occasionList()}`]); continue; }
    base = `occasion-${id}`;
  }
  if (!slots.has(base)) {
    skipped.push([rel2(full), `doesn't match a photo on the site. Expected one of: ${[...slots].filter((s) => !s.startsWith('occasion-')).join(', ')}, occasion-<id>, or a gallery/<id>/ folder`]);
    continue;
  }
  if (seenSlots.has(base)) { skipped.push([rel2(full), `${seenSlots.get(base)} is already used for ${base}`]); continue; }
  seenSlots.set(base, entry.name);
  jobs.push({ kind: 'slot', src: full, slot: base });
}

function readGallery(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => natural(a.name, b.name))) {
    if (IGNORE.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (!entry.isDirectory()) { skipped.push([rel2(full), 'put gallery photos in a folder named after the occasion, e.g. gallery/birthday/']); continue; }
    const id = occasionId(entry.name);
    if (!id) { skipped.push([rel2(full) + '/', `no occasion called "${entry.name}". Use one of: ${occasionList()}`]); continue; }
    for (const f of readdirSync(full, { withFileTypes: true }).sort((a, b) => natural(a.name, b.name))) {
      if (IGNORE.test(f.name)) continue;
      const file = path.join(full, f.name);
      if (f.isDirectory()) { skipped.push([rel2(file) + '/', 'folders inside an occasion folder are ignored']); continue; }
      const problem = checkImageFile(file);
      if (problem) { skipped.push([rel2(file), problem]); continue; }
      jobs.push({ kind: 'gallery', src: file, occasion: id });
    }
  }
}
function rel2(p) { return path.relative(input, p); }

// ── Process every photo in memory first: nothing is written unless it worked ─
async function processPhoto(src) {
  const meta = await sharp(src, { failOn: 'error' }).metadata();
  const out = await sharp(src, { failOn: 'error' })
    .rotate() // upright, using the camera's orientation flag (which is then dropped with everything else)
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb')
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  // Privacy guarantee: refuse to continue if any hidden data survived.
  const check = await sharp(out.data).metadata();
  if (check.exif || check.xmp || check.iptc || check.comments?.length) throw new Error('hidden data was not fully removed');
  return { data: out.data, width: out.info.width, height: out.info.height, hadGps: hasGps(meta.exif) };
}

/** Does this EXIF block carry a GPS location? (IFD0 tag 0x8825 = GPSInfo) */
function hasGps(exif) {
  try {
    if (!exif || exif.length < 14) return false;
    let t = exif.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? 6 : 0;
    const le = exif.toString('latin1', t, t + 2) === 'II';
    const u16 = (o) => (le ? exif.readUInt16LE(t + o) : exif.readUInt16BE(t + o));
    const u32 = (o) => (le ? exif.readUInt32LE(t + o) : exif.readUInt32BE(t + o));
    const ifd0 = u32(4);
    const count = u16(ifd0);
    for (let i = 0; i < count; i++) if (u16(ifd0 + 2 + i * 12) === 0x8825) return true;
  } catch {
    /* unreadable EXIF: it's removed either way */
  }
  return false;
}

const done = [];
for (const job of jobs) {
  try {
    Object.assign(job, await processPhoto(job.src));
    done.push(job);
  } catch (err) {
    skipped.push([rel2(job.src), `couldn't be read as a photo (${err.message.split('\n')[0]})`]);
  }
}

// ── Plan the gallery changes ─────────────────────────────────────────────────
const yamlText = readFileSync(GALLERY_YAML, 'utf8');
const entries = (yaml.load(yamlText) ?? []).map((e) => ({ ...e, placeholder: e.placeholder === true, showOnHome: e.showOnHome === true }));
const galleryJobs = done.filter((j) => j.kind === 'gallery');
const newByOcc = new Map();
for (const j of galleryJobs) newByOcc.set(j.occasion, [...(newByOcc.get(j.occasion) ?? []), j]);

const realOccasions = new Set(entries.filter((e) => !e.placeholder).flatMap((e) => e.occasions ?? []));
for (const occ of newByOcc.keys()) realOccasions.add(occ);
// A placeholder goes once every occasion it stands in for has a real photo — but only for occasions touched now.
const removed = entries.filter((e) => e.placeholder && (e.occasions ?? []).some((o) => newByOcc.has(o)) && (e.occasions ?? []).every((o) => realOccasions.has(o)));
const removedIds = new Set(removed.map((e) => e.id));
const kept = entries.filter((e) => !removedIds.has(e.id));

const imagePath = (e) => path.resolve(path.dirname(GALLERY_YAML), e.image);
// Placeholder image files to delete: not used by any kept entry, nor anywhere else in src/.
const srcFiles = listFiles(path.join(root, 'src')).filter((f) => /\.(astro|ts|tsx|js|mjs|md|mdx|ya?ml|json|css)$/.test(f) && f !== GALLERY_YAML);
const srcText = srcFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
const deleteFiles = [];
const keepFiles = [];
for (const e of removed) {
  const file = imagePath(e);
  const name = path.basename(file);
  if (!existsSync(file)) continue;
  if (kept.some((k) => imagePath(k) === file) || srcText.includes(name)) keepFiles.push(file);
  else deleteFiles.push(file);
}

const usedIds = new Set(kept.map((e) => e.id));
const usedFiles = new Set(readdirSync(PHOTOS).filter((f) => !deleteFiles.includes(path.join(PHOTOS, f))));
let maxOrder = Math.max(0, ...entries.map((e) => Number(e.order) || 0));
const added = [];
for (const [occ, list] of newByOcc) {
  const freed = removed.filter((e) => (e.occasions ?? []).includes(occ)).sort((a, b) => a.order - b.order);
  let homeSpots = freed.filter((e) => e.showOnHome).length;
  let n = 1;
  for (const job of list) {
    while (usedIds.has(`${occ}-${n}`) || usedFiles.has(`gallery-${occ}-${n}.jpg`)) n++;
    const id = `${occ}-${n}`;
    const file = `gallery-${occ}-${n}.jpg`;
    usedIds.add(id);
    usedFiles.add(file);
    const slot = freed.shift();
    const order = slot ? slot.order : ++maxOrder;
    const showOnHome = homeSpots > 0;
    if (showOnHome) homeSpots--;
    added.push({ id, file, occ, order, showOnHome, job, alt: defaultAlt(occ) });
  }
}

function defaultAlt(occ) {
  const name = occasions.get(occ)?.name ?? occ;
  const titled = name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).length > 1; // "Be My Girlfriend" stays as is
  const n = titled ? name : name.charAt(0).toLowerCase() + name.slice(1);
  return /picnic/i.test(n) ? `Blush Picnic ${n} setup in Toronto` : `Blush Picnic ${n} picnic setup in Toronto`;
}

function listFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

// ── Edit gallery.yaml as text (comments and layout stay as they are) ─────────
function editGalleryYaml(text) {
  const lines = text.split('\n');
  const starts = [];
  lines.forEach((l, i) => { if (/^- /.test(l)) starts.push(i); });
  const drop = new Set();
  starts.forEach((start, k) => {
    const m = lines[start].match(/^- id:\s*["']?([^"'\s#]+)["']?/);
    if (!m || !removedIds.has(m[1])) return;
    let end = (starts[k + 1] ?? lines.length) - 1;
    // leave comments/blank lines that sit right above the next item where they are
    while (end > start && (/^\s*$/.test(lines[end]) || /^#/.test(lines[end]))) end--;
    for (let i = start; i <= end; i++) drop.add(i);
    if (/^\s*$/.test(lines[end + 1] ?? 'x')) drop.add(end + 1); // and one blank line after it
  });
  let out = lines.filter((_, i) => !drop.has(i)).join('\n');
  if (/^\s*\[\s*\]\s*$/m.test(out.replace(/^#.*$/gm, ''))) out = out.replace(/^\s*\[\s*\]\s*$/m, ''); // "[]" (empty list)
  out = out.replace(/\s*$/, '\n');
  if (added.length) {
    out += added
      .map((a) => [
        '',
        `- id: ${a.id}`,
        `  image: "../assets/photos/${a.file}"`,
        `  alt: ${JSON.stringify(a.alt)}  # TODO: describe this photo`,
        `  occasions: [${JSON.stringify(a.occ)}]`,
        `  order: ${a.order}`,
        `  showOnHome: ${a.showOnHome}`,
        `  placeholder: false`,
      ].join('\n'))
      .join('\n') + '\n';
  }
  return out.replace(/\n{3,}/g, '\n\n');
}
const newYaml = editGalleryYaml(yamlText);
// Prove the edit: it must parse, and contain exactly the expected entries.
{
  const parsed = yaml.load(newYaml) ?? [];
  const ids = parsed.map((e) => e.id);
  const expected = [...kept.map((e) => e.id), ...added.map((a) => a.id)];
  const same = ids.length === expected.length && expected.every((id) => ids.includes(id)) && new Set(ids).size === ids.length;
  if (!same) {
    console.error('\nStopped: editing src/content/gallery.yaml went wrong, so nothing was changed. Please send this message to your developer.');
    process.exit(1);
  }
}

// ── Write (unless --dry-run) ─────────────────────────────────────────────────
const writeAtomic = (file, data) => { const tmp = `${file}.tmp-${process.pid}`; writeFileSync(tmp, data); renameSync(tmp, file); };
if (!dryRun) {
  for (const j of done.filter((d) => d.kind === 'slot')) writeAtomic(path.join(PHOTOS, `${j.slot}.jpg`), j.data);
  for (const f of deleteFiles) unlinkSync(f);
  for (const a of added) writeAtomic(path.join(PHOTOS, a.file), a.job.data);
  if (newYaml !== yamlText) writeAtomic(GALLERY_YAML, newYaml);
  // Real photos take over from AI illustrations: drop them from src/assets/photos/ai-photos.json
  // (so the site's AI-illustration notes stop counting them) and list them in real-photos.json, which
  // `npm run ai-photos` never overwrites.
  const real = [...done.filter((d) => d.kind === 'slot').map((j) => `${j.slot}.jpg`), ...added.map((a) => a.file)];
  const aiLog = path.join(PHOTOS, 'ai-photos.json');
  if (existsSync(aiLog)) {
    const ai = JSON.parse(readFileSync(aiLog, 'utf8'));
    const gone = [...real, ...deleteFiles.map((f) => path.basename(f))].filter((f) => f in ai);
    for (const f of gone) delete ai[f];
    if (gone.length) writeAtomic(aiLog, JSON.stringify(ai, null, 2) + '\n');
  }
  if (real.length) {
    const realList = path.join(PHOTOS, 'real-photos.json');
    const known = new Set(existsSync(realList) ? JSON.parse(readFileSync(realList, 'utf8')) : []);
    for (const f of real) known.add(f);
    writeAtomic(realList, JSON.stringify([...known].sort(), null, 2) + '\n');
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
const kb = (n) => `${Math.round(n / 1024)} KB`;
const say = (s = '') => console.log(s);
say(dryRun ? '\nDry run: this is what would happen. Nothing was changed.\n' : '\nPhotos updated.\n');
const slotJobs = done.filter((d) => d.kind === 'slot');
if (slotJobs.length) {
  say(`Replaced ${slotJobs.length} photo${slotJobs.length > 1 ? 's' : ''}:`);
  for (const j of slotJobs) say(`  ${j.slot}.jpg  ← ${rel2(j.src)}  (${j.width}×${j.height}, ${kb(j.data.length)}${j.hadGps ? ', location data removed' : ''})`);
  say();
}
if (added.length) {
  say(`Added ${added.length} gallery photo${added.length > 1 ? 's' : ''}:`);
  for (const a of added) say(`  ${a.file}  ← ${rel2(a.job.src)}  (${a.job.width}×${a.job.height}${a.showOnHome ? ', on the home page' : ''}${a.job.hadGps ? ', location data removed' : ''})`);
  say();
}
if (removed.length) {
  say(`Removed ${removed.length} placeholder gallery entr${removed.length > 1 ? 'ies' : 'y'} (${removed.map((e) => e.id).join(', ')})${deleteFiles.length ? ` and ${deleteFiles.length} placeholder image${deleteFiles.length > 1 ? 's' : ''}` : ''}.`);
  for (const f of keepFiles) say(`  kept ${rel(f)}: it's still used elsewhere`);
  say();
}
if (!slotJobs.length && !added.length) say('No photos were changed.\n');
if (skipped.length) {
  say(`Skipped ${skipped.length}:`);
  for (const [f, why] of skipped) say(`  ${f}: ${why}`);
  say();
}

// Soft-photo warnings: big spots want big photos.
const big = /^(hero|about|occasion-)/;
const soft = slotJobs.filter((j) => big.test(j.slot) && Math.max(j.width, j.height) < 1600);
if (soft.length) {
  say('These may look soft on large screens (under 1600 px on the long side); use a larger original if you have one:');
  for (const j of soft) say(`  ${j.slot}.jpg (${j.width}×${j.height})`);
  say();
}

// ── Alt-text checklist ───────────────────────────────────────────────────────
const todo = [];
for (const j of slotJobs) {
  const pkg = j.slot.match(/^pkg-(.+)$/);
  const occ = j.slot.match(/^occasion-(.+)$/);
  if (pkg) {
    const p = (yaml.load(readFileSync(path.join(root, 'src/content/packages.yaml'), 'utf8')) ?? []).find((x) => x.id === pkg[1]);
    todo.push(`src/content/packages.yaml → ${pkg[1]} → imageAlt${p?.imageAlt ? `\n      now: "${p.imageAlt}"` : ''}`);
  } else if (occ) {
    const o = occasions.get(occ[1]);
    todo.push(`${rel(o.file)} → heroAlt${o.data.heroAlt ? `\n      now: "${o.data.heroAlt}"` : ''}`);
  } else {
    const users = srcFiles.filter((f) => readFileSync(f, 'utf8').includes(`${j.slot}.jpg`)).map(rel);
    todo.push(`${j.slot}.jpg: the alt text where it's used${users.length ? `: ${users.join(', ')}` : ''}`);
  }
}
for (const a of added) todo.push(`src/content/gallery.yaml → ${a.id} → alt (marked "# TODO: describe this photo")`);
if (todo.length) {
  say('Next: describe what each new photo shows (its "alt text"). Replace any text that says "Placeholder".');
  say('Say what’s in it, e.g. "Low picnic table with pink roses and candles under a willow tree at sunset".');
  for (const t of todo) say(`  • ${t}`);
  say();
}
if (!dryRun && (slotJobs.length || added.length)) {
  say('Then preview with  npm run dev  (open http://localhost:4321/gallery), and deploy (HANDOVER.md → Deploying).');
}
