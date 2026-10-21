/**
 * Brand assets.
 *
 * The mark is a market scale — a beam on a fulcrum with a single weighted
 * pan. A scale is how a price is decided in a Bangladeshi market: the
 * balance settles on a number. The asymmetry (one pan, not two) keeps it
 * from reading as a generic "justice" or "finance" icon, and the red disc
 * in the pan is the price itself.
 *
 * Everything is inline SVG so it costs nothing to serve, needs no font or
 * image pipeline, and stays crisp at any size.
 */

export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" aria-label="দরদেখা">
  <path d="M24 28.5 L30.5 40 H17.5 Z" fill="#2a3a6b"/>
  <rect x="14.5" y="39" width="19" height="2.6" rx="1.3" fill="#131a2e"/>
  <rect x="5" y="13.5" width="38" height="3" rx="1.5" fill="#131a2e"/>
  <path d="M13 16.5 V25" stroke="#3a4566" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M6 25 H20 L17.6 30.4 H8.4 Z" fill="#3a4566"/>
  <path d="M35 16.5 V25" stroke="#3a4566" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M28 25 H42 L39.6 30.4 H30.4 Z" fill="#3a4566"/>
  <circle cx="35" cy="26.6" r="2.5" fill="#b52b2b"/>
</svg>`;

/** Wordmark: the scale mark beside the Bengali name. */
export function logoMark(size = 34): string {
  return `<span class="brand-mark" aria-hidden="true">${LOGO_SVG}</span>`;
}

/** Open Graph / card image — drawn, not uploaded. */
export function ogImage(title: string, subtitle: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#eef1f7"/>
  <rect x="0" y="0" width="1200" height="14" fill="#b52b2b"/>
  <g transform="translate(96 96) scale(1.6)">${LOGO_SVG}</g>
  <text x="96" y="300" font-family="Tiro Bangla, serif" font-size="86" fill="#131a2e">${esc(title)}</text>
  <text x="96" y="382" font-family="Anek Bangla, sans-serif" font-size="38" fill="#3a4566">${esc(subtitle)}</text>
  <line x1="96" y1="440" x2="1104" y2="440" stroke="#cdd6e8" stroke-width="2"/>
  <text x="96" y="500" font-family="IBM Plex Mono, monospace" font-size="26" fill="#6b769a">dordekha · মাঠের বাজারের সরকারি দর</text>
</svg>`;
}
