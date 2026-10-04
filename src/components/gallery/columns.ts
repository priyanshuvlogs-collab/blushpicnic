// Which gallery photos sit at the top of a column, worked out at build time.
//
// The gallery grid is a CSS multi-column masonry (`columns: 2 | 3 | 4`, `break-inside: avoid`).
// Browsers balance it to the shortest column height that still fits every item, filling column 1
// top to bottom, then column 2, and so on. So the photos on screen when the page opens are not
// "the first few" in the list but the first photo of each column. Re-running the same balancing
// here from each photo's aspect ratio finds them, so exactly those load eagerly (and the phone
// layout's two get fetchpriority="high"). Checked against Chromium at 320–1440px.

export interface ColumnLayout {
  /** number of columns */
  cols: number;
  /** viewport width in px (the column width is derived from the page's layout CSS below) */
  viewport: number;
  /** horizontal gap between columns, px (`column-gap`) */
  colGap: number;
  /** vertical space between two items in a column, px (`.gallery-item` margin-bottom) */
  rowGap: number;
  /** fixed height under each photo, px (the caption row) */
  below: number;
}

/** Column width for `.container-x` (max 76rem, gutter clamp(1rem, 4vw, 2.5rem)). */
export function columnWidth(viewport: number, cols: number, colGap: number): number {
  const gutter = Math.min(40, Math.max(16, viewport * 0.04));
  const inner = Math.min(viewport, 1216) - 2 * gutter;
  return (inner - colGap * (cols - 1)) / cols;
}

/**
 * Indices of the items that start each column, given each item's height ÷ width.
 * Mirrors the browser: find the shortest column height that fits everything, then fill greedily.
 */
export function columnStarts(ratios: number[], layout: ColumnLayout): number[] {
  if (!ratios.length) return [];
  const width = columnWidth(layout.viewport, layout.cols, layout.colGap);
  const heights = ratios.map((r) => r * width + layout.below);
  const { rowGap, cols } = layout;

  const fill = (limit: number) => {
    const starts = [0];
    let h = 0;
    heights.forEach((x, i) => {
      if (i > 0 && h + rowGap + x > limit + 0.01) {
        starts.push(i);
        h = x;
      } else {
        h += (i > 0 ? rowGap : 0) + x;
      }
    });
    return starts;
  };

  let lo = Math.max(...heights);
  let hi = heights.reduce((a, b) => a + b, 0) + rowGap * (heights.length - 1);
  if (fill(lo).length <= cols) return fill(lo);
  for (let k = 0; k < 60 && hi - lo > 0.01; k++) {
    const mid = (lo + hi) / 2;
    if (fill(mid).length <= cols) hi = mid;
    else lo = mid;
  }
  return fill(hi);
}
