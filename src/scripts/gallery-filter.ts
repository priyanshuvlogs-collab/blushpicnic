// Gallery occasion filter.
//   • Toggle buttons ([data-filter], aria-pressed) show only the photos tagged with that occasion.
//   • The choice is kept in the URL (?occasion=<id>) with history.replaceState, and read on load,
//     so occasion pages can link to /gallery?occasion=proposal.
//   • The result count is announced politely ([data-gallery-status] is role="status").
//   • The placeholder note shows only while a visible photo is a placeholder.
//   • The "book" link under the grid follows the filter: /book?occasion=<id>.
// The page's head script sets html[data-gallery-occasion] before first paint (no flash of every
// photo when arriving filtered); this script takes over and removes it.

const PARAM = 'occasion';

function init(root: HTMLElement) {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-filter]')];
  const items = [...root.querySelectorAll<HTMLElement>('[data-gallery-item]')];
  const grid = root.querySelector<HTMLElement>('[data-gallery-grid]');
  const status = root.querySelector<HTMLElement>('[data-gallery-status]');
  const note = root.querySelector<HTMLElement>('[data-gallery-placeholder]');
  const book = root.querySelector<HTMLAnchorElement>('[data-gallery-book]');
  const page = root.querySelector<HTMLAnchorElement>('[data-gallery-page]');
  const pageLabel = page?.querySelector<HTMLElement>('[data-gallery-page-label]');
  const scroller = root.querySelector<HTMLElement>('.filter-list');
  if (!buttons.length || !items.length) return;

  const valid = new Set(buttons.map((b) => b.dataset.filter ?? ''));
  let current = 'all';

  const plural = (n: number) => `${n} ${n === 1 ? 'photo' : 'photos'}`;

  function revealChip(btn: HTMLElement) {
    // Keep the pressed chip in view inside the horizontal strip (phones) without moving the page.
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
    const left = btn.offsetLeft - scroller.clientWidth / 2 + btn.offsetWidth / 2;
    scroller.scrollTo({ left: Math.max(0, left), behavior: 'auto' });
  }

  function apply(requested: string, { updateUrl }: { updateUrl: boolean }) {
    const id = valid.has(requested) ? requested : 'all';
    current = id;

    let count = 0;
    let placeholders = false;
    for (const item of items) {
      const tags = (item.dataset.occasions ?? '').split(/\s+/);
      const show = id === 'all' || tags.includes(id);
      item.hidden = !show;
      if (show) {
        count++;
        if (item.dataset.placeholder === 'true') placeholders = true;
      }
    }

    let active: HTMLButtonElement | undefined;
    for (const b of buttons) {
      const on = b.dataset.filter === id;
      b.setAttribute('aria-pressed', String(on));
      if (on) active = b;
    }

    if (grid) grid.dataset.count = String(count);
    if (note) note.hidden = !placeholders;
    if (status) {
      status.textContent = id === 'all' ? `Showing all ${plural(count)}` : `Showing ${plural(count)}: ${active?.textContent?.trim() ?? ''}`;
    }

    // Contextual next step under the grid.
    if (book) {
      const d = active?.dataset;
      if (id === 'all' || !d?.book) {
        book.href = book.dataset.defaultHref ?? '/book';
        book.textContent = book.dataset.defaultLabel ?? 'Book your picnic';
        delete book.dataset.trackOccasion;
      } else {
        book.href = d.book;
        book.textContent = `Plan your ${d.phrase ?? 'picnic'}`;
        book.dataset.trackOccasion = id;
      }
    }
    if (page && pageLabel) {
      const d = active?.dataset;
      if (id === 'all' || !d?.page) {
        page.href = page.dataset.defaultHref ?? '/occasions';
        pageLabel.textContent = page.dataset.defaultLabel ?? 'Explore every occasion';
      } else {
        page.href = d.page;
        pageLabel.textContent = `More about ${d.plural ?? 'these picnics'}`;
      }
    }

    if (updateUrl) {
      const url = new URL(window.location.href);
      if (id === 'all') url.searchParams.delete(PARAM);
      else url.searchParams.set(PARAM, id);
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    }
    if (active) revealChip(active);
  }

  for (const b of buttons) {
    b.addEventListener('click', () => {
      const id = b.dataset.filter ?? 'all';
      // Pressing the active filter again goes back to "All".
      apply(id === current && id !== 'all' ? 'all' : id, { updateUrl: true });
    });
  }

  const initial = new URLSearchParams(window.location.search).get(PARAM);
  // An unknown ?occasion= falls back to "All" and is removed from the address bar.
  apply(initial ?? 'all', { updateUrl: initial !== null && !valid.has(initial) });
  document.documentElement.removeAttribute('data-gallery-occasion');
}

const root = document.querySelector<HTMLElement>('[data-gallery]');
if (root) init(root);

export {};
