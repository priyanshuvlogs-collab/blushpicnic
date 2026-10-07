// GA4 + Meta Pixel loader. Imported on demand by ConsentBanner.astro, and only after the visitor
// has accepted analytics cookies — until then not a byte of this file (or Google/Meta code) loads.
//
// Once running, window.bpSend(event, params) forwards the site's events (see src/scripts/track.ts):
//   GA4:   gtag('event', event, params)
//   Pixel: booking_submit                          → fbq('track', 'Lead')
//          click_call / click_text / click_instagram → fbq('track', 'Contact', { content_name })
//          anything else                            → fbq('trackCustom', event, params)

type Params = Record<string, string | number | boolean | undefined>;
type Fn = (...args: unknown[]) => void;
interface Fbq extends Fn {
  callMethod?: Fn;
  queue: unknown[];
  push: Fbq;
  loaded: boolean;
  version: string;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Fn;
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

export interface AnalyticsIds {
  ga4?: string;
  pixel?: string;
}

const GA4_ID = /^G-[A-Z0-9]{4,20}$/;
const PIXEL_ID = /^\d{6,20}$/;
const CONTACT_EVENTS = new Set(['click_call', 'click_text', 'click_instagram', 'click_tiktok']);

let gaStarted = false;
let pixelStarted = false;

function addScript(src: string) {
  const el = document.createElement('script');
  el.async = true;
  el.src = src;
  document.head.appendChild(el);
}

function startGa4(id: string) {
  (window as unknown as Record<string, unknown>)[`ga-disable-${id}`] = false;
  if (gaStarted) {
    window.gtag?.('consent', 'update', { analytics_storage: 'granted' });
    return;
  }
  gaStarted = true;
  window.dataLayer = window.dataLayer || [];
  // gtag needs the real `arguments` object, so this must be a classic function.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  const gtag = window.gtag;
  // Consent Mode v2: everything denied by default…
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'denied',
    personalization_storage: 'denied',
    security_storage: 'granted',
  });
  gtag('set', 'ads_data_redaction', true);
  // …then analytics only, because that is what the visitor agreed to. Ad storage stays denied.
  gtag('consent', 'update', { analytics_storage: 'granted' });
  gtag('js', new Date());
  gtag('config', id, {
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`);
}

function startPixel(id: string) {
  if (pixelStarted) {
    window.fbq?.('consent', 'grant');
    return;
  }
  pixelStarted = true;
  if (!window.fbq) {
    // Meta Pixel base code, unminified.
    const n = function () {
      // eslint-disable-next-line prefer-rest-params
      if (n.callMethod) n.callMethod.apply(n, arguments as unknown as unknown[]);
      // eslint-disable-next-line prefer-rest-params
      else n.queue.push(arguments);
    } as Fbq;
    n.push = n;
    n.loaded = true;
    n.version = '2.0';
    n.queue = [];
    window.fbq = n;
    if (!window._fbq) window._fbq = n;
    addScript('https://connect.facebook.net/en_US/fbevents.js');
  }
  const fbq = window.fbq!;
  fbq('consent', 'grant');
  // No automatic button/metadata scraping: we send the few events we need ourselves.
  fbq('set', 'autoConfig', false, id);
  fbq('init', id);
  fbq('track', 'PageView');
}

function clean(params: Params = {}): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') out[k] = v;
  return out;
}

/** Start GA4 and/or the Meta Pixel. Call only after the visitor has accepted analytics cookies. */
export function loadAnalytics(ids: AnalyticsIds) {
  const ga4 = ids.ga4 && GA4_ID.test(ids.ga4) ? ids.ga4 : '';
  const pixel = ids.pixel && PIXEL_ID.test(ids.pixel) ? ids.pixel : '';
  if (ga4) startGa4(ga4);
  if (pixel) startPixel(pixel);
  if (!ga4 && !pixel) return;

  window.bpSend = (event, params) => {
    const data = clean(params);
    if (ga4) window.gtag?.('event', event, data);
    if (pixel && window.fbq) {
      if (event === 'booking_submit') window.fbq('track', 'Lead', data);
      else if (CONTACT_EVENTS.has(event)) window.fbq('track', 'Contact', { content_name: event });
      else window.fbq('trackCustom', event, data);
    }
  };
}

/** The visitor withdrew consent: stop sending, deny storage and remove the cookies already set. */
export function revokeAnalytics(ids: AnalyticsIds = {}) {
  delete window.bpSend;
  window.gtag?.('consent', 'update', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  if (ids.ga4) (window as unknown as Record<string, unknown>)[`ga-disable-${ids.ga4}`] = true;
  window.fbq?.('consent', 'revoke');
  clearCookies((name) => name === '_ga' || name.startsWith('_ga_') || name === '_gid' || name.startsWith('_gat') || name === '_fbp' || name === '_fbc');
}

function clearCookies(match: (name: string) => boolean) {
  const host = location.hostname;
  const parts = host.split('.');
  const domains = new Set(['', host, `.${host}`]);
  for (let i = 1; i < parts.length - 1; i++) domains.add(`.${parts.slice(i).join('.')}`);
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0]?.trim();
    if (!name || !match(name)) continue;
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}; SameSite=Lax`;
    }
  }
}
