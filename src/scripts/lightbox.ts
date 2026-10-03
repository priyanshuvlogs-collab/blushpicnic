// Photo lightbox on a native <dialog> (markup: src/components/gallery/Lightbox.astro).
//
// Triggers are links marked [data-lightbox-item] whose href is the large image, so everything
// works without JavaScript. Each carries:
//   data-full / data-full-w / data-full-h   large WebP (loaded only when viewed)
//   data-caption                            alt text, shown as the caption
//   data-name                               occasion name (dialog title)
//   data-book / data-occasion               "Book this look" → /book?occasion=<id>
//   data-page / data-page-label             optional link to the occasion page
//
// Keyboard: Esc closes (native), ←/→ move, Home/End jump. Focus starts on Close and returns to
// the photo you were looking at. Touch: swipe left/right. Hidden (filtered-out) photos are skipped.

const dialog = document.querySelector<HTMLDialogElement>('[data-lightbox]');

if (dialog && typeof dialog.showModal === 'function') {
  const $ = <T extends Element>(sel: string) => dialog.querySelector<T>(sel)!;
  const img = $<HTMLImageElement>('[data-lb-img]');
  const stage = $<HTMLElement>('[data-lb-stage]');
  const count = $<HTMLElement>('[data-lb-count]');
  const title = $<HTMLElement>('[data-lb-title]');
  const desc = $<HTMLElement>('[data-lb-desc]');
  const book = $<HTMLAnchorElement>('[data-lb-book]');
  const page = $<HTMLAnchorElement>('[data-lb-page]');
  const live = $<HTMLElement>('[data-lb-live]');
  const closeBtn = $<HTMLButtonElement>('[data-lb-close]');
  const prevBtn = $<HTMLButtonElement>('[data-lb-prev]');
  const nextBtn = $<HTMLButtonElement>('[data-lb-next]');

  const allTriggers = () => [...document.querySelectorAll<HTMLAnchorElement>('[data-lightbox-item]')];
  const visibleTriggers = () => allTriggers().filter((a) => !a.closest('[hidden]'));

  let list: HTMLAnchorElement[] = [];
  let index = 0;
  let loadToken = 0;

  // Progressive enhancement: the links now open a dialog, so they behave like buttons.
  for (const a of allTriggers()) {
    a.setAttribute('role', 'button');
    a.setAttribute('aria-haspopup', 'dialog');
  }

  function show(i: number, announce: boolean) {
    const n = list.length;
    if (!n) return;
    index = ((i % n) + n) % n;
    const t = list[index];
    const d = t.dataset;

    // Show the already-loaded grid image straight away, then swap in the large file.
    const token = ++loadToken;
    const thumb = t.querySelector('img')?.currentSrc ?? '';
    const w = Number(d.fullW) || 0;
    const h = Number(d.fullH) || 0;
    if (w && h) {
      img.width = w;
      img.height = h;
    }
    if (thumb) {
      img.src = thumb;
      stage.dataset.loading = 'true';
    } else {
      img.removeAttribute('src');
      stage.dataset.loading = 'true';
    }
    const full = new Image();
    full.decoding = 'async';
    full.src = d.full ?? t.href;
    const swap = () => {
      if (token !== loadToken) return;
      img.src = full.src;
      stage.dataset.loading = 'false';
    };
    // If the large file fails, keep the grid image rather than showing a broken one.
    const keep = () => {
      if (token !== loadToken) return;
      if (!thumb) img.src = full.src;
      stage.dataset.loading = 'false';
    };
    full.decode().then(swap, keep);

    title.textContent = d.name ?? '';
    desc.textContent = d.caption ?? '';
    count.textContent = `${index + 1} / ${n}`;

    book.href = d.book ?? '/book';
    if (d.occasion) book.dataset.trackOccasion = d.occasion;
    else delete book.dataset.trackOccasion;

    if (d.page && d.pageLabel) {
      page.href = d.page;
      page.textContent = d.pageLabel;
      page.hidden = false;
    } else {
      page.textContent = '';
      page.hidden = true;
    }

    const single = n < 2;
    prevBtn.hidden = single;
    nextBtn.hidden = single;

    if (announce) live.textContent = `Photo ${index + 1} of ${n}: ${d.caption ?? ''}`;
  }

  function open(trigger: HTMLAnchorElement) {
    list = visibleTriggers();
    const i = list.indexOf(trigger);
    if (i < 0) return;
    live.textContent = '';
    show(i, false);
    dialog!.showModal();
    document.documentElement.classList.add('overflow-hidden');
    closeBtn.focus();
  }

  const close = () => dialog.open && dialog.close();

  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('overflow-hidden');
    loadToken++;
    // Return focus to the photo being viewed (it may differ from the one that opened the dialog).
    list[index]?.focus();
  });

  document.addEventListener('click', (e) => {
    const t = (e.target as Element | null)?.closest<HTMLAnchorElement>('[data-lightbox-item]');
    if (!t) return;
    // Let modified clicks (new tab / window) open the image as a normal link.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    open(t);
  });

  // role="button" links should also respond to the Space key.
  document.addEventListener('keydown', (e) => {
    if (e.key !== ' ') return;
    const t = (e.target as Element | null)?.closest<HTMLAnchorElement>('[data-lightbox-item]');
    if (!t) return;
    e.preventDefault();
    open(t);
  });

  prevBtn.addEventListener('click', () => show(index - 1, true));
  nextBtn.addEventListener('click', () => show(index + 1, true));
  closeBtn.addEventListener('click', close);

  dialog.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => show(index - 1, true),
      ArrowRight: () => show(index + 1, true),
      Home: () => show(0, true),
      End: () => show(list.length - 1, true),
    };
    const fn = keys[e.key];
    if (fn && list.length > 1) {
      e.preventDefault();
      fn();
    }
  });

  // Click on the dark space around the photo closes, like most lightboxes.
  dialog.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el === dialog || el.hasAttribute('data-lb-dismiss')) close();
  });

  // Swipe left/right on touch screens.
  let startX = 0;
  let startY = 0;
  let tracking = false;
  stage.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) {
        tracking = false;
        return;
      }
      tracking = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    },
    { passive: true },
  );
  stage.addEventListener(
    'touchend',
    (e) => {
      if (!tracking || list.length < 2) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) show(index + (dx < 0 ? 1 : -1), true);
    },
    { passive: true },
  );
}

export {};
