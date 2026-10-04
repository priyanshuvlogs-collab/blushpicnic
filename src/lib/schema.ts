// JSON-LD builders. Pass the results to <BaseLayout jsonLd={[...]}>.
import type { Settings, Package, Occasion } from './site';
import { plainMd, money } from './site';
import { picnicPhrase, capitalize } from '../components/occasion/text';

type Thing = Record<string, unknown>;

export const businessId = (s: Settings) => `${s.url}/#business`;

/** The business's social profiles (Google Business Profile can be added here once it exists). */
const profiles = (s: Settings) => [s.instagramUrl, s.tiktokUrl].filter(Boolean);

/**
 * A small LocalBusiness node for `provider` / `about`. The full node is only on the home page, and
 * Google doesn't follow an @id to another page, so each page names the business itself.
 */
export const businessRef = (s: Settings): Thing => ({
  '@type': 'LocalBusiness',
  '@id': businessId(s),
  name: s.name,
  url: s.url,
  telephone: s.phoneE164,
});

/** "From $375 before HST" — from the lowest package price (pass to localBusiness as priceRange). */
export const priceRange = (s: Settings, packages: Package[]) =>
  `From ${money(Math.min(...packages.map((p) => p.data.priceFrom)))} ${s.taxNote}`;

// Former municipalities that are now part of the City of Toronto: places within Toronto, not cities.
const TORONTO_DISTRICTS = new Set(['north york', 'scarborough', 'etobicoke', 'east york', 'york', 'downtown toronto', 'midtown toronto']);
const toronto = { '@type': 'City', name: 'Toronto' };

/** Service-area business: city, province and country only — no street address is published. */
export function localBusiness(s: Settings, opts: { image?: string; priceRange?: string } = {}): Thing {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': businessId(s),
    name: s.name,
    description: s.description,
    url: s.url,
    email: s.email,
    telephone: s.phoneE164,
    image: opts.image,
    logo: `${s.url}/logo.png`,
    priceRange: opts.priceRange,
    address: { '@type': 'PostalAddress', addressLocality: 'Toronto', addressRegion: 'ON', addressCountry: 'CA' },
    sameAs: profiles(s),
    areaServed: [
      toronto,
      { '@type': 'AdministrativeArea', name: 'Greater Toronto Area' },
      ...s.serviceAreaList
        .filter((name) => name !== 'Toronto')
        .map((name) =>
          TORONTO_DISTRICTS.has(name.toLowerCase()) ? { '@type': 'Place', name, containedInPlace: toronto } : { '@type': 'City', name },
        ),
    ],
  };
}

export function website(s: Settings): Thing {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${s.url}/#website`,
    url: s.url,
    name: s.name,
    publisher: { '@id': businessId(s) },
  };
}

export function service(s: Settings, p: Package, opts: { image?: string } = {}): Thing {
  const d = p.data;
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: d.name,
    serviceType: 'Luxury picnic setup',
    description: d.summary,
    image: opts.image,
    provider: businessRef(s),
    areaServed: { '@type': 'AdministrativeArea', name: 'Greater Toronto Area' },
    offers: {
      '@type': 'Offer',
      priceCurrency: 'CAD',
      price: d.priceFrom,
      priceSpecification: {
        '@type': 'PriceSpecification',
        price: d.priceFrom,
        priceCurrency: 'CAD',
        minPrice: d.priceFrom,
        valueAddedTaxIncluded: false,
      },
      description: `Starting at ${money(d.priceFrom)} ${d.guestsLabel}, ${s.taxNote}. ${s.locationNote}`,
      url: `${s.url}/book?package=${p.id}`,
    },
  };
}

export function faqPage(items: { q: string; a: string }[]): Thing {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: plainMd(a) },
    })),
  };
}

/** crumbs: [{ name: 'Packages', path: '/packages' }] — Home is added automatically. */
export function breadcrumbs(s: Settings, crumbs: { name: string; path: string }[]): Thing {
  const all = [{ name: 'Home', path: '/' }, ...crumbs];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: all.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: `${s.url}${c.path === '/' ? '' : c.path}`,
    })),
  };
}

export function occasionService(s: Settings, o: Occasion, pkg: Package, opts: { image?: string } = {}): Thing {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    // "Proposal picnic in Toronto", "Picnic date in Toronto" — the phrase the page's headings use
    name: `${capitalize(picnicPhrase(o))} in Toronto`,
    serviceType: 'Luxury picnic setup',
    description: o.data.metaDescription,
    image: opts.image,
    provider: businessRef(s),
    areaServed: { '@type': 'AdministrativeArea', name: 'Greater Toronto Area' },
    offers: {
      '@type': 'Offer',
      priceCurrency: 'CAD',
      price: pkg.data.priceFrom,
      priceSpecification: {
        '@type': 'PriceSpecification',
        price: pkg.data.priceFrom,
        priceCurrency: 'CAD',
        minPrice: pkg.data.priceFrom,
        valueAddedTaxIncluded: false,
      },
      description: `${pkg.data.name} starting at ${money(pkg.data.priceFrom)} ${pkg.data.guestsLabel}, ${s.taxNote}. ${s.locationNote}`,
      url: `${s.url}/book?occasion=${o.id}&package=${pkg.id}`,
    },
  };
}
