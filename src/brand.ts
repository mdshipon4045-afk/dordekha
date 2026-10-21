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

export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-label="দরদেখা">
  <rect x="2" y="6.6" width="20" height="2.3" rx="1.15" fill="#131a2e"/>
  <rect x="11.1" y="8.9" width="1.8" height="5.4" fill="#131a2e"/>
  <path d="M12 14.3 L15.6 20.2 H8.4 Z" fill="#2a3a6b"/>
  <rect x="5.4" y="19.9" width="13.2" height="2.2" rx="1.1" fill="#131a2e"/>
  <path d="M6 8.9 V11.3" stroke="#3a4566" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M2.4 11.3 H9.6 L7.9 14.5 H4.1 Z" fill="#3a4566"/>
  <path d="M18 8.9 V11.3" stroke="#3a4566" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M14.4 11.3 H21.6 L19.9 14.5 H16.1 Z" fill="#3a4566"/>
  <circle cx="18" cy="12.5" r="1.55" fill="#b52b2b"/>
</svg>`;

/** Wordmark: the scale mark beside the Bengali name. */
export function logoMark(size = 34): string {
  return `<span class="brand-mark" aria-hidden="true">${LOGO_SVG}</span>`;
}

/**
 * The hero figure: a page of the ledger, with the actual current entry
 * written on it.
 *
 * A photograph of a market would be a stock-photo cliché, and a decorative
 * illustration would be decoration. What the subject actually looks like is
 * a ruled sheet with a red margin rule and a few rows of figures on it — so
 * that is what the figure is, and the figures on it are real.
 */
export function ledgerFigure(rows: { name: string; place: string; value: string; fresh: boolean }[]): string {
  const sheet = rows
    .map((r, i) => {
      const y = 128 + i * 30;
      const stamp = r.fresh
        ? `<rect x="196" y="${y - 11}" width="40" height="15" rx="2" fill="#e6f1e9"/>
           <text x="216" y="${y - 0.5}" font-size="9" font-family="IBM Plex Mono, monospace" fill="#2c6b3d" text-anchor="middle">নতুন</text>`
        : `<rect x="196" y="${y - 11}" width="46" height="15" rx="2" fill="#f6efdd"/>
           <text x="219" y="${y - 0.5}" font-size="9" font-family="IBM Plex Mono, monospace" fill="#96702a" text-anchor="middle">পূর্বের</text>`;
      return `<line x1="28" y1="${y + 10}" x2="252" y2="${y + 10}" stroke="#e1e7f2" stroke-width="1"/>
      <text x="28" y="${y}" font-size="12.5" font-family="Anek Bangla, sans-serif" fill="#131a2e">${escXml(r.name)}</text>
      <text x="118" y="${y}" font-size="11.5" font-family="Anek Bangla, sans-serif" fill="#6b769a">${escXml(r.place)}</text>
      <text x="188" y="${y}" font-size="13" font-family="IBM Plex Mono, monospace" fill="#131a2e" text-anchor="end">${escXml(r.value)}</text>
      ${stamp}`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 240" role="img" aria-label="আজকের খাতার একটি পাতা" class="ledger-figure">
  <defs>
    <filter id="sheet" x="-20%" y="-20%" width="150%" height="150%">
      <feDropShadow dx="0" dy="8" stdDeviation="9" flood-color="#131a2e" flood-opacity="0.13"/>
    </filter>
  </defs>
  <rect x="18" y="14" width="244" height="212" rx="3" fill="#ffffff" filter="url(#sheet)"/>
  <rect x="18" y="14" width="244" height="30" fill="#f2f5ee"/>
  <line x1="18" y1="44" x2="262" y2="44" stroke="#ccd5e8" stroke-width="1"/>
  <line x1="196" y1="44" x2="196" y2="226" stroke="#e3b8b8" stroke-width="2"/>
  <text x="30" y="34" font-size="12" font-family="IBM Plex Mono, monospace" fill="#3a4566" letter-spacing="1.6">আজকের খাতা</text>
  <text x="252" y="34" font-size="10" font-family="IBM Plex Mono, monospace" fill="#9aa3bd" text-anchor="end">খুচরা · টাকা</text>
  <text x="30" y="66" font-size="10" font-family="IBM Plex Mono, monospace" fill="#9aa3bd" letter-spacing="1.2">পণ্য</text>
  <text x="118" y="66" font-size="10" font-family="IBM Plex Mono, monospace" fill="#9aa3bd" letter-spacing="1.2">জেলা</text>
  <text x="188" y="66" font-size="10" font-family="IBM Plex Mono, monospace" fill="#9aa3bd" text-anchor="end">গড়</text>
  ${sheet}
  <rect x="18" y="14" width="3" height="212" fill="#b52b2b"/>
</svg>`;
}

function escXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
