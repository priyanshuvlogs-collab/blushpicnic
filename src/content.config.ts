// Content schemas. Every editable fact on the site lives in src/content/ and is validated here,
// so a typo in a price or a missing field fails the build instead of shipping a broken page.
import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

const money = z.number().nonnegative();

// One entry ("site") holding business facts, analytics IDs and booking-form settings.
const settings = defineCollection({
  loader: file('src/content/settings.yaml'),
  schema: z.object({
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
      priceFrom: money,
      guestsIncluded: z.number().int().positive(),
      guestsMax: z.number().int().positive().nullable(),
      guestsLabel: z.string(),
      extraGuestPrice: money.nullable(),
      durationHours: z.number().positive(),
      includesFrom: z.string().nullable(),
      includes: z.array(z.string()),
      bestFor: z.array(z.string()),
      image: image(),
      imageAlt: z.string(),
      priceNote: z.string().optional(),
    }),
});

const addons = defineCollection({
  loader: file('src/content/addons.yaml'),
  schema: z.object({
    name: z.string(),
    order: z.number(),
    description: z.string(),
    // null = "price on request" (not counted in the live estimate)
    price: money.nullable(),
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
      recommendedPackage: z.enum(['signature', 'proposal-romance', 'celebration']),
      metaTitle: z.string().max(65),
      metaDescription: z.string().min(70).max(160),
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
    metaDescription: z.string().min(70).max(160),
    lede: z.string().optional(),
    hasPlaceholders: z.boolean().default(false),
  }),
});

// Booking form questions (conditional per occasion). Also exported as /api/form-schema.json so the
// PHP handler validates exactly the same fields the browser shows.
const field = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string(),
  type: z.enum(['text', 'textarea', 'number', 'date', 'time', 'month', 'email', 'tel', 'select', 'radio', 'checkboxes', 'toggle']),
  required: z.boolean().default(false),
  help: z.string().optional(),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
  // fill options from another collection instead of listing them here
  source: z.enum(['occasions', 'packages', 'addons']).optional(),
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
  showIf: z.object({ field: z.string(), equals: z.string().optional() }).optional(),
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

export const collections = { settings, packages, addons, occasions, faqs, gallery, reviews, pages, formGroups };
