// Content schemas. Every editable fact on the site lives in src/content/ and is validated here,
// so a typo in a price or a missing field fails the build instead of shipping a broken page.
import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

const money = z.number().nonnegative();
// A price, fee or surcharge: a positive amount, or null where the YAML means "quoted". A zero would
// show "$0" on the site and in emails, so it's refused — leave the value null instead.
const price = z.number().positive();

// "$1,200": the same format as money() in src/lib/site.ts (site.ts reads the collections, so the config can't import it).
const dollars = (n: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0, minimumFractionDigits: 0 })
    .format(n)
    .replace('CA', '');

/**
 * The deposit summaries are written with {deposit}, {depositPercent}, {securityDeposit} and
 * {securityReturned}, filled here from the numbers beside them, so changing an amount in settings.yaml
 * updates every page and email that shows a summary. An unknown {token} fails the build with a clear
 * message instead of showing up on the site; a typed "$100" only warns (like occasion copy does).
 */
const SUMMARY_TOKEN = /\{([a-zA-Z]+)\}/g;
function fillSummary(where: string, text: string, values: Record<string, string>, ctx: z.core.$RefinementCtx) {
  const unknown = [...text.matchAll(SUMMARY_TOKEN)].map((m) => m[0]).filter((t) => !(t.slice(1, -1) in values));
  if (unknown.length) {
    const known = Object.keys(values).map((k) => `{${k}}`).join(', ');
    ctx.addIssue({ code: 'custom', path: [where, 'summary'], message: `settings.yaml ${where}.summary: unknown ${unknown.join(', ')}. Available: ${known}.` });
  }
  const typed = text.match(/\$\d[\d,]*/g);
  if (typed) console.warn(`[content] settings.yaml ${where}.summary contains a typed amount (${typed.join(', ')}). Use {deposit} or {securityDeposit} so it updates with the numbers above it.`);
  return text.replace(SUMMARY_TOKEN, (m, k: string) => values[k] ?? m);
}

// One entry ("site") holding business facts, analytics IDs and booking-form settings.
const settings = defineCollection({
  loader: file('src/content/settings.yaml'),
  schema: z
    .object({
      name: z.string(),
      domain: z.string(),
      url: z.url(),
      email: z.email(),
      phoneDisplay: z.string(),
      phoneE164: z.string().regex(/^\+\d{10,15}$/),
      smsBody: z.string(),
      instagramHandle: z.string(),
      instagramUrl: z.url(),
      tiktokHandle: z.string(),
      tiktokUrl: z.url(),
      serviceArea: z.string(),
      serviceAreaList: z.array(z.string()),
      replyTime: z.string(),
      heroAlt: z.string().min(10),
      tagline: z.string(),
      description: z.string(),
      deposit: z.object({
        standard: money,
        largeEventPercent: z.number().min(1).max(100),
        summary: z.string(),
      }),
      securityDeposit: z.object({
        amount: money,
        returnedWithin: z.string(),
        summary: z.string(),
      }),
      taxNote: z.string(),
      locationNote: z.string(),
      // Travel fee by area, added to every quote. fee: null = quoted by area (not in the live estimate).
      travel: z.object({
        note: z.string(),
        areas: z.array(z.object({ name: z.string(), fee: price.nullable() })).min(1),
      }),
      analytics: z.object({
        ga4Id: z.string(),
        metaPixelId: z.string(),
      }),
      booking: z.object({
        // "php" posts to /api/book.php (Hostinger SMTP). "web3forms" posts to Web3Forms instead.
        provider: z.enum(['php', 'web3forms']),
        endpoint: z.string(),
        web3formsAccessKey: z.string(),
        letterBoardMaxWords: z.number().int().positive(),
      }),
    })
    .transform((s, ctx) => {
      const values = {
        deposit: dollars(s.deposit.standard),
        depositPercent: `${s.deposit.largeEventPercent}%`,
        securityDeposit: dollars(s.securityDeposit.amount),
        securityReturned: s.securityDeposit.returnedWithin,
      };
      return {
        ...s,
        deposit: { ...s.deposit, summary: fillSummary('deposit', s.deposit.summary, values, ctx) },
        securityDeposit: { ...s.securityDeposit, summary: fillSummary('securityDeposit', s.securityDeposit.summary, values, ctx) },
      };
    }),
});

const packages = defineCollection({
  loader: file('src/content/packages.yaml'),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      order: z.number(),
      featured: z.boolean().default(false),
      tagline: z.string(),
      summary: z.string(),
      priceFrom: price,
      guestsIncluded: z.number().int().positive(),
      guestsMax: z.number().int().positive().nullable(),
      guestsLabel: z.string(),
      extraGuestPrice: price.nullable(),
      durationHours: z.number().positive(),
      includesFrom: z.string().nullable(),
      includes: z.array(z.string()),
      bestFor: z.array(z.string()),
      image: image(),
      imageAlt: z.string(),
      priceNote: z.string().optional(),
    }),
});

// Picnic styles (styles.yaml): how the picnic is set. included: true = comes with every package.
const styles = defineCollection({
  loader: file('src/content/styles.yaml'),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      order: z.number(),
      description: z.string(),
      included: z.boolean().default(false),
      // null = quoted (not counted in the live estimate)
      price: price.nullable(),
      image: image(),
      imageAlt: z.string().min(10),
    }),
});

// What the business offers (services.yaml): picnics, proposals, room decor, hampers. The first
// question of the booking form lists them; href is the page that explains each one.
const services = defineCollection({
  loader: file('src/content/services.yaml'),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      order: z.number(),
      short: z.string(),
      summary: z.string(),
      href: z.string().regex(/^\/[a-z0-9\-\/#]*$/),
      cta: z.string(),
      image: image(),
      imageAlt: z.string().min(10),
      // true: the call to action is an Instagram DM (custom hampers), not the booking form
      dm: z.boolean().default(false),
      // the refundable security deposit (rented decor and equipment) applies to this service
      securityDeposit: z.boolean().default(true),
    }),
});

const addons = defineCollection({
  loader: file('src/content/addons.yaml'),
  schema: z.object({
    name: z.string(),
    order: z.number(),
    description: z.string(),
    // null = "price on request" (not counted in the live estimate)
    price: price.nullable(),
    priceSuffix: z.string().default(''),
  }),
});

const faq = z.object({ q: z.string(), a: z.string() });

const occasions = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/occasions' }),
  schema: ({ image }) =>
    z.object({
      name: z.string(), // "Proposal"
      chip: z.string(), // short label for the occasions strip, e.g. "Proposals"
      urlSlug: z.string().regex(/^[a-z0-9-]+$/), // page URL: /<urlSlug>. Not called "slug": Astro would use it as the id.
      order: z.number(),
      formGroup: z.enum([
        'none',
        'birthday',
        'anniversary',
        'romance',
        'couple',
        'family',
        'honour',
        'new-baby',
        'baby',
        'bridal',
      ]),
      recommendedPackage: z.enum(['simple', 'signature', 'proposal-romance', 'celebration']),
      metaTitle: z.string().max(65),
      metaDescription: z.string().min(70).max(220), // ≤160 after {tokens} are filled (checked at build)
      h1: z.string(),
      lede: z.string(),
      heroImage: image(),
      heroAlt: z.string(),
      highlights: z.array(z.object({ title: z.string(), text: z.string() })).min(3).max(4),
      faqs: z.array(faq).min(3),
      related: z.array(z.string()).max(4).default([]),
    }),
});

const faqs = defineCollection({
  loader: file('src/content/faqs.yaml'),
  schema: z.object({
    question: z.string(),
    answer: z.string(), // supports simple **bold** and [links](/path)
    category: z.enum(['booking', 'pricing', 'the-day', 'locations', 'policies']),
    order: z.number(),
    showOnHome: z.boolean().default(false),
  }),
});

const gallery = defineCollection({
  loader: file('src/content/gallery.yaml'),
  schema: ({ image }) =>
    z.object({
      image: image(),
      alt: z.string().min(10),
      occasions: z.array(z.string()).min(1),
      order: z.number(),
      showOnHome: z.boolean().default(false),
      placeholder: z.boolean().default(false),
    }),
});

// Only real reviews, shared with the client's permission. The reviews section stays hidden while empty.
const reviews = defineCollection({
  loader: file('src/content/reviews.yaml'),
  schema: z.object({
    name: z.string(), // first name or initials only
    occasion: z.string(),
    text: z.string(),
    date: z.string(), // e.g. "2026-08"
    source: z.enum(['google', 'instagram', 'email', 'text']),
    permission: z.literal(true),
  }),
});

// Long-form page copy: about, policies, privacy. Markdown so the owner can edit prose directly.
const pages = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    metaTitle: z.string().max(65),
    metaDescription: z.string().min(70).max(220), // ≤160 after {tokens} are filled (checked at build)
    lede: z.string().optional(),
    hasPlaceholders: z.boolean().default(false),
  }),
});

// Booking form questions (conditional per occasion). Also exported as /api/form-schema.json so the
// PHP handler validates exactly the same fields the browser shows.
const showIfCondition = z
  .object({ field: z.string(), equals: z.string().optional(), in: z.array(z.string()).min(1).optional() })
  .refine((c) => !(c.equals !== undefined && c.in !== undefined), { message: 'showIf: use either "equals" or "in", not both' });

const field = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string(),
  type: z.enum(['text', 'textarea', 'number', 'date', 'time', 'month', 'email', 'tel', 'select', 'radio', 'checkboxes', 'toggle']),
  required: z.boolean().default(false),
  help: z.string().optional(),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
  // fill options from another collection instead of listing them here
  // (areas = settings.yaml travel areas + "Somewhere else in the GTA" + "Not sure yet")
  source: z.enum(['occasions', 'packages', 'addons', 'services', 'styles', 'areas']).optional(),
  // lay out two "half" fields side by side on wider screens
  half: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  maxLength: z.number().optional(),
  maxWords: z.number().optional(),
  autocomplete: z.string().optional(),
  // only show for these occasion ids (within a group); omitted = whole group
  onlyFor: z.array(z.string()).optional(),
  // only show when another field has a truthy / specific value, e.g. { field: "is_surprise", equals: "yes" }
  // or one of several values: { field: "service", in: ["picnics", "proposals"] }
  // Several conditions (a list) must all hold: [{ field: is_surprise, equals: "yes" }, { field: service, in: [...] }]
  showIf: z.union([showIfCondition, z.array(showIfCondition).min(1)]).optional(),
  // the answer follows another field's answer and the question is hidden (browser only; the server
  // just validates the value): { field: "service", values: { proposals: "proposal" } }
  lockBy: z.object({ field: z.string(), values: z.record(z.string(), z.string()) }).optional(),
  note: z.string().optional(),
});

const formGroups = defineCollection({
  loader: file('src/content/booking-form.yaml'),
  schema: z.object({
    title: z.string(),
    step: z.number().int().min(1).max(4),
    // which occasion formGroup(s) this block appears for; "*" = everyone
    appliesTo: z.array(z.string()),
    order: z.number(),
    intro: z.string().optional(),
    fields: z.array(field),
  }),
});

export const collections = { settings, packages, addons, styles, services, occasions, faqs, gallery, reviews, pages, formGroups };
