import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const render = readFileSync("src/render.ts", "utf8");
const pages = readFileSync("src/pages.ts", "utf8");
const css = render.match(/const CSS = `([\s\S]*?)`;/)?.[1] ?? "";
const markup = `${render}\n${pages}`;

/** Classes added at runtime by the client script. */
const RUNTIME_CLASSES = ["on", "err", "ans"];

describe("stylesheet coverage", () => {
  const used = new Set<string>();
  for (const m of markup.matchAll(/class="([^"]+)"/g)) {
    for (const c of m[1].split(/\s+/)) {
      if (!c || c.includes("${") || c.includes("?")) continue;
      used.add(c);
    }
  }
  for (const c of RUNTIME_CLASSES) used.add(c);

  const defined = new Set<string>();
  for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) defined.add(m[1]);

  it("styles every class the markup uses", () => {
    const missing = [...used].filter((c) => !defined.has(c));
    expect(missing, `unstyled classes: ${missing.join(", ")}`).toEqual([]);
  });

  it("hides the skip link until it is focused", () => {
    // It must not be visible on the page, and it must still be reachable.
    expect(css).toMatch(/\.skip\s*\{[^}]*position:absolute/);
    expect(css).toMatch(/\.skip:focus\s*\{[^}]*position:fixed/);
  });

  it("gives every page the ids the client script expects", () => {
    const app = readFileSync("public/app.js", "utf8");
    const ids = [...app.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);
    const htmlIds = new Set([...markup.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    expect(ids.filter((i) => !htmlIds.has(i))).toEqual([]);
  });
});
