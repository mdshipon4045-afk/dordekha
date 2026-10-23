/**
 * Every other door into a company: the contact form, the phone number,
 * the WhatsApp link — the channels that do not depend on an inbox that
 * refuses our mail.
 */
import { readFileSync, writeFileSync } from "node:fs";

const prospects = JSON.parse(readFileSync(".private/prospects.json", "utf8"));
const UA = { "User-Agent": "Mozilla/5.0 (compatible; dordekha/1.0; +https://dordekha.pages.dev)" };

async function get(url) {
  try {
    const res = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(20000) });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

const PAGES = ["/contact", "/contact-us", "/contactus", "/", "/about", "/about-us"];
const out = [];

for (const p of prospects) {
  const found = { company: p.company, domain: p.domain, email: p.email, pages: [], phones: [], whatsapp: [], forms: [], contactPage: null };

  for (const path of PAGES) {
    const url = `https://${p.domain}${path}`;
    const html = await get(url);
    if (!html) continue;
    found.pages.push(path);

    // Phone numbers, in the shapes Bangladesh actually writes them.
    for (const m of html.matchAll(/(?:tel:)(\+?\d[\d\-(). ]{6,18})/gi)) {
      found.phones.push(m[1].replace(/[^\d+]/g, ""));
    }
    for (const m of html.matchAll(/(?:\+?880|0)1[3-9]\d{8}/g)) {
      found.phones.push(m[0].replace(/\D/g, ""));
    }
    for (const m of html.matchAll(/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)[/=]?(\+?\d{8,15})/gi)) {
      found.whatsapp.push(m[1].replace(/\D/g, ""));
    }

    // A form that can carry a message.
    for (const fm of html.matchAll(/<form\b([\s\S]{0,2500}?)<\/form>/gi)) {
      const block = fm[0];
      const head = fm[1].slice(0, 400);
      if (!/textarea|message|comment|inquiry|enquiry/i.test(block)) continue;
      const action = /action\s*=\s*["']([^"']*)["']/i.exec(head)?.[1] ?? "(none)";
      const method = /method\s*=\s*["']([^"']*)["']/i.exec(head)?.[1]?.toUpperCase() ?? "GET";
      const inputs = [...block.matchAll(/<input\b[^>]*name\s*=\s*["']([^"']+)["']/gi)].map((x) => x[1]);
      const captcha = /recaptcha|hcaptcha|turnstile|g-recaptcha/i.test(block) ? "captcha" : "none";
      found.forms.push({ page: path, action, method, inputs: [...new Set(inputs)].slice(0, 12), captcha });
      if (!found.contactPage) found.contactPage = path;
    }
  }

  found.phones = [...new Set(found.phones)].slice(0, 4);
  found.whatsapp = [...new Set(found.whatsapp)].slice(0, 2);
  out.push(found);
  console.log(
    `${p.company.padEnd(34)} forms=${found.forms.length} captcha=${found.forms.map((f) => f.captcha).join(",") || "-"} phones=${found.phones.join(",") || "-"} wa=${found.whatsapp.join(",") || "-"}`,
  );
}

writeFileSync(".private/contact-channels.json", JSON.stringify(out, null, 1), "utf8");
console.log("\nwritten: .private/contact-channels.json");
