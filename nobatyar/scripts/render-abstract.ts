/**
 * Render docs/graphical-abstract.html to docs/graphical-abstract.png.
 *
 * The web fonts are inlined as base64 so the render does not depend on any
 * network or on file:// font rules, then the page is screenshotted at 2× for a
 * crisp 3200×2000 poster.
 *
 *   npm run abstract
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const HTML = join(root, "docs", "graphical-abstract.html");
const PNG = join(root, "docs", "graphical-abstract.png");

const FONT_DIR = join(root, "node_modules", "@fontsource-variable");

async function fontFace(family: string, file: string, unicodeRange: string): Promise<string> {
  const bytes = await readFile(join(FONT_DIR, file));
  return `@font-face {
  font-family: "${family}";
  font-style: normal;
  font-weight: 100 900;
  font-display: block;
  src: url(data:font/woff2;base64,${bytes.toString("base64")}) format("woff2");
  unicode-range: ${unicodeRange};
}`;
}

async function main(): Promise<void> {
  const faces = await Promise.all([
    // Persian + Arabic script and the Latin glyphs it needs
    fontFace(
      "Vazirmatn",
      "vazirmatn/files/vazirmatn-arabic-wght-normal.woff2",
      "U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0898-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FEFF",
    ),
    fontFace("Vazirmatn", "vazirmatn/files/vazirmatn-latin-wght-normal.woff2", "U+0000-00FF"),
    fontFace("Inter", "inter/files/inter-latin-wght-normal.woff2", "U+0000-00FF"),
  ]);

  const html = (await readFile(HTML, "utf8")).replace(
    "/*FONT_FACE*/",
    faces.join("\n"),
  );

  const browser = await chromium.launch();
  let height = 880;
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 2,
    });
    await page.setContent(html, { waitUntil: "load" });
    // the poster is typography-heavy: never screenshot before the web fonts
    // are actually usable, otherwise Persian text falls back to a system font
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.fonts].map((face) => face.load().catch(() => undefined)),
      );
      await document.fonts.ready;
    });

    // crop to the real content height: no dead space, no clipped card
    height = await page.evaluate(
      () => Math.ceil(document.querySelector(".sheet")?.getBoundingClientRect().height ?? 880),
    );
    await page.setViewportSize({ width: 1600, height });
    await page.waitForTimeout(300);
    await page.screenshot({ path: PNG, fullPage: false, timeout: 60_000 });
  } finally {
    await browser.close();
  }

  const bytes = await readFile(PNG);
  console.log(`✔ ${PNG} (${Math.round(bytes.length / 1024)} KB, ${1600 * 2}×${height * 2})`);

  // keep a self-contained copy next to the png, fonts included
  const inlined = join(root, "docs", "graphical-abstract.standalone.html");
  await writeFile(inlined, html, "utf8");
  console.log(`✔ ${inlined} (fonts inlined — open it in any browser, no server needed)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
