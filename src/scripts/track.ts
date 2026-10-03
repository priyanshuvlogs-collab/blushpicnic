// Event tracking facade. Pages and components call window.bpTrack() or use data-track
// attributes; the analytics loader (consent-gated) decides whether anything is sent.
//
// Events: booking_start, booking_step {step}, booking_submit, click_call, click_text,
//         click_instagram, package_select {package}, booking_cta {location}

type Params = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    bpTrack: (event: string, params?: Params) => void;
    bpSend?: (event: string, params?: Params) => void; // set by the analytics loader after consent
  }
}

window.bpTrack = (event, params = {}) => {
  try {
    window.bpSend?.(event, params);
  } catch {
    /* analytics must never break the page */
  }
};

function paramsFrom(el: HTMLElement): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(el.dataset)) {
    if (k.startsWith('track') && k !== 'track' && v !== undefined) {
      const key = k.slice(5).replace(/^[A-Z]/, (c) => c.toLowerCase()).replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
      out[key] = v;
    }
  }
  return out;
}

document.addEventListener(
  'click',
  (e) => {
    const el = (e.target as Element | null)?.closest<HTMLElement>('[data-track]');
    if (el?.dataset.track) window.bpTrack(el.dataset.track, paramsFrom(el));
  },
  { capture: true },
);

export {};
