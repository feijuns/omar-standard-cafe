import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../cloudflare-pages/index.html", import.meta.url), "utf8");

test("mobile redesign is isolated to the requested breakpoint", () => {
  assert.match(html, /@media \(max-width: 767px\)/);
  assert.match(
    html,
    /\.mobile-card-price,\s*\.mobile-card-actions,\s*\.product-sheet-layer\s*\{\s*display: none;/,
  );
  assert.match(html, /@media \(max-width: 767px\)[\s\S]*\.product-card\.assorted-card/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
});

test("mobile product photos retain the desktop 2:3 portrait ratio", () => {
  assert.match(
    html,
    /@media \(max-width: 767px\)[\s\S]*?\.product-card \.photo-slot,[\s\S]*?width:\s*112px;\s*height:\s*168px;\s*aspect-ratio:\s*2 \/ 3;/,
  );
});

test("mobile card typography stays compact and the quick-buy label does not wrap", () => {
  assert.match(html, /\.product-card \.product-name[\s\S]*?font-size:\s*17px/);
  assert.match(html, /\.product-card \.notes[\s\S]*?font-size:\s*11px/);
  assert.match(html, /\.product-card \.recommendation[\s\S]*?font-size:\s*11px/);
  assert.match(html, /\.product-card \.product-body\s*\{\s*min-width:\s*0/);
  assert.match(html, /\.product-card \.notes[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(html, /\.mobile-quick-buy[\s\S]*?white-space:\s*nowrap/);
  assert.match(html, /availableVariants\.length \? "選購" : "暫時售完"/);
  assert.match(html, />詳情 ＋<\/button>/);
});

test("compact cards provide quick-buy and detail paths from shared products", () => {
  assert.match(html, /data-sheet-open="quick-buy"/);
  assert.match(html, /data-sheet-open="detail"/);
  assert.match(html, /function productCard\(product\)/);
  assert.match(html, /const allProducts = catalogProducts\.concat\(assortedProducts\)/);
  assert.match(html, /mobilePrice/);
});

test("one accessible bottom sheet supports detail and quick-buy modes", () => {
  assert.match(html, /id="productSheet" role="dialog" aria-modal="true"/);
  assert.match(html, /productSheetState\.mode === "detail"/);
  assert.match(html, /id="sheetVariants"/);
  assert.match(html, /id="sheetQtyMinus"/);
  assert.match(html, /id="sheetNote" maxlength="200"/);
  assert.match(html, /event\.key === "Escape"/);
  assert.match(html, /setProductSheetBackgroundInert\(true\)/);
  assert.match(html, /productSheetState\.trigger\.focus/);
  assert.match(html, /document\.body\.style\.position = "fixed"/);
  assert.match(html, /window\.scrollTo\(0, productSheetState\.pageScrollY\)/);
});

test("quantity, sold-out handling, notes, and cart data use existing order flow", () => {
  assert.match(html, /Math\.max\(1, productSheetState\.quantity - 1\)/);
  assert.match(html, /variant\.soldOut/);
  assert.match(html, /function addToCart\(productId, variantId, quantity, note\)/);
  assert.match(html, /note: safeNote/);
  assert.match(html, /商品備註：\\n/);
  assert.match(html, /items: cart\.map/);
  assert.match(html, /fetch\("\/api\/orders"/);
});

test("inline application script remains syntactically valid", () => {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, "inline script should exist");
  assert.doesNotThrow(() => new Function(match[1]));
});
