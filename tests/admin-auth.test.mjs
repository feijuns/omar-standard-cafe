import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath = new URL("../cloudflare-pages/functions/api/admin/orders.js", import.meta.url);
const source = await readFile(sourcePath, "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const { onRequestGet } = await import(moduleUrl);

function dbReturningNoOrders() {
  return {
    prepare() {
      return { all: async () => ({ results: [] }) };
    },
  };
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(hash).toString("hex");
}

test("accepts the configured plain token", async () => {
  const response = await onRequestGet({
    request: new Request("https://example.test/api/admin/orders", {
      headers: { "x-admin-token": "configured-secret" },
    }),
    env: { DB: dbReturningNoOrders(), ADMIN_TOKEN: "configured-secret" },
  });

  assert.equal(response.status, 200);
});

test("accepts a deployment-safe token hash when the plain secret is absent or changed", async () => {
  const fallbackToken = "test-only-fallback-token";
  const response = await onRequestGet({
    request: new Request("https://example.test/api/admin/orders", {
      headers: { "x-admin-token": fallbackToken },
    }),
    env: {
      DB: dbReturningNoOrders(),
      ADMIN_TOKEN: "different-deployment-secret",
      ADMIN_TOKEN_SHA256: await digest(fallbackToken),
    },
  });

  assert.equal(response.status, 200);
});

test("rejects requests without valid credentials", async () => {
  const response = await onRequestGet({
    request: new Request("https://example.test/api/admin/orders"),
    env: { DB: dbReturningNoOrders(), ADMIN_TOKEN: "configured-secret" },
  });

  assert.equal(response.status, 401);
});

test("admin page stores the token and removes it from the address bar", async () => {
  const html = await readFile(new URL("../cloudflare-pages/admin.html", import.meta.url), "utf8");
  assert.match(html, /localStorage\.setItem\("omar-standard-admin-token", urlToken\)/);
  assert.match(html, /params\.delete\("token"\)/);
  assert.match(html, /history\.replaceState/);
});
