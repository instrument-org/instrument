import { describe, expect, it } from "vitest";

import { pageConnection } from "./page-connection";

describe("pageConnection", () => {
  it.each([
    ["https://booking.com/hotels", "secure"],
    ["file:///Users/me/report.html", "secure"],
    ["about:blank", "secure"],
    ["not a url", "secure"],
    ["http://neverssl.com/", "insecure"],
    ["http://0.0.0.0:8080/", "insecure"],
    ["http://192.168.1.10/", "insecure"],
    ["http://localhost:5173/", "local"],
    ["http://app.localhost/", "local"],
    ["http://127.0.0.1:3000/", "local"],
    ["http://127.4.5.6/", "local"],
    ["http://[::1]:8000/", "local"],
  ])("%s is %s", (url, expected) => {
    expect(pageConnection(url)).toBe(expected);
  });

  it.each([
    ["https://expired.badssl.com/", "certificate"],
    ["https://expired.badssl.com:8443/", "secure"],
    ["https://localhost:8444/", "certificate"],
    ["http://expired.badssl.com/", "insecure"],
  ])("%s with a certificate let through is %s", (url, expected) => {
    expect(pageConnection(url, ["expired.badssl.com", "localhost:8444"])).toBe(
      expected,
    );
  });
});
