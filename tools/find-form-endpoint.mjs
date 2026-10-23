/**
 * Behind a form that renders in the browser there is usually a plain
 * endpoint: Formspree, Getform, Web3Forms, or the site's own script.
 * If we find it, the letter can go in without an inbox and without a
 * phone call.
 */
const sites = [
  "https://farmercare.asia/contact",
  "https://insurecow.com/",
  "https://www.creativeresearch.com.bd/en/contact",
  "https://fashol.com/contact",
  "https://agrinofy.com/contact",
  "https://directfreshbd.com/",
];

const UA = { "User-Agent": "Mozilla/5.0 (compatible; dordekha-research)" };
const PATTERNS = [
  /formspree\.io\/f\/[A-Za-z0-9]+/g,
  /getform\.io\/[A-Za-z0-9/_-]+/g,
  /formcarry\.com\/[A-Za-z0-9_-]+/g,
  /(?:api\.)?web3forms\.com\/[A-Za-z0-9/_-]*/g,
  /usebasin\.com\/[A-Za-z0-9/_-]+/g,
  /formsubmit\.co\/[A-Za-z0-9@._-]+/g,
  /https?:\/\/[^"'`\s<>]*(?:contact|sendmail|inquiry|enquiry|message)[^"'`\s<>]*/gi,
];

async function text(url) {
  try {
    const res = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

for (const site of sites) {
  const origin = new URL(site).origin;
  const html = await text(site);
  const found = new Set();

  const scan = (s) => {
    for (const re of PATTERNS) {
      for (const m of s.matchAll(re)) found.add(m[0]);
    }
  };
  scan(html);

  // The scripts the page loads, same origin only.
  const srcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
    .map((m) => m[1])
    .map((s) => (s.startsWith("http") ? s : new URL(s, origin).href))
    .filter((u) => u.startsWith(origin))
    .slice(0, 8);
  for (const src of srcs) {
    const js = await text(src);
    if (js.length > 600_000) continue;
    scan(js);
  }

  const hits = [...found].filter((u) => !/\.(png|jpg|jpeg|svg|webp|css)(\?|$)/i.test(u)).slice(0, 8);
  console.log(`\n${site}`);
  console.log(`  scripts: ${srcs.length}`);
  for (const h of hits) console.log(`   -> ${h}`);
  if (!hits.length) console.log("   (no endpoint in the markup or the first scripts)");
}
