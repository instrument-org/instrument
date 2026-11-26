import { describe, expect, it } from "vitest";

import { onSameSite } from "./same-site";

describe("onSameSite", () => {
  it.each([
    ["www.amazon.com", "https://www.amazon.com", true],
    ["amazon.com", "https://www.amazon.com/gp/css/order-history", true],
    ["accounts.example.com", "https://example.com", true],
    ["example.com", "https://admin.example.com/login", true],
    ["accounts.shopify.com", "https://admin.shopify.com", true],
    ["accounts.google.com", "https://drive.google.com", true],
    ["shop.example.co.uk", "https://example.co.uk", true],
    ["other.co.uk", "https://example.co.uk", false],
    ["shopify.dev", "https://admin.shopify.com", false],
    ["notamazon.com", "https://amazon.com", false],
    ["", "https://amazon.com", false],
    ["amazon.com", "not a url", false],
  ])("%s on %s: %s", (host, url, same) => {
    expect(onSameSite(host, url)).toBe(same);
  });
});
