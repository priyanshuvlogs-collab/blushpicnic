// JSON-LD builders. Pass the results to <BaseLayout jsonLd={[...]}>.
import type { Settings, Package, Occasion } from './site';
import { plainMd } from './site';

type Thing = Record<string, unknown>;

export const businessId = (s: Settings) => `${s.url}/#business`;

/** Service-area business: no street address is published. */
export function localBusiness(s: Settings, opts: { image?: string } = {}): Thing {
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
    priceRange: '$$$',
    sameAs: [s.instagramUrl],
    areaServed: [
      { '@type': 'City', name: 'Toronto' },
      { '@type': 'AdministrativeArea', name: 'Greater Toronto Area' },
      ...s.serviceAreaList.filter((c) => c !== 'Toronto').map((name) => ({ '@type': 'City', name })),
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
    provider: { '@id': businessId(s) },
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
      description: `Starting at $${d.priceFrom} ${d.guestsLabel}, ${s.taxNote}. ${s.locationNote}`,
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
    name: `${o.data.name} picnic setup in Toronto`,
    serviceType: 'Luxury picnic setup',
    description: o.data.metaDescription,
    image: opts.image,
    provider: { '@id': businessId(s) },
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
      description: `${pkg.data.name} starting at $${pkg.data.priceFrom} ${pkg.data.guestsLabel}, ${s.taxNote}.`,
      url: `${s.url}/book?occasion=${o.id}&package=${pkg.id}`,
    },
  };
}
