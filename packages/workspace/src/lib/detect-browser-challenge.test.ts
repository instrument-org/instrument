import { describe, expect, it } from "vitest";

import {
  browserChallengeAdvisory,
  detectBrowserChallenge,
} from "./detect-browser-challenge";

describe("detectBrowserChallenge", () => {
  const positiveCases: [string, { title?: string; url?: string }, string][] = [
    [
      "Cloudflare interstitial title",
      { title: "Just a moment...", url: "https://shop.example.com/" },
      "cloudflare",
    ],
    [
      "Cloudflare challenge-platform path",
      {
        title: "",
        url: "https://x.example.com/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1",
      },
      "cloudflare",
    ],
    [
      "Cloudflare chk_jschl path",
      { url: "https://x.example.com/cdn-cgi/l/chk_jschl?foo=1" },
      "cloudflare",
    ],
    [
      "Turnstile hosted host",
      { url: "https://challenges.cloudflare.com/turnstile/v0/api.js" },
      "cloudflare",
    ],
    [
      "checking your browser title",
      { title: "Checking your browser before accessing example.com" },
      "cloudflare",
    ],
    [
      "hCaptcha host",
      { url: "https://newassets.hcaptcha.com/captcha/v1/hcaptcha.html" },
      "hcaptcha",
    ],
    [
      "reCAPTCHA endpoint",
      { url: "https://www.google.com/recaptcha/api2/bframe?k=abc" },
      "recaptcha",
    ],
    [
      "generic human-verification title",
      { title: "Verify you are human", url: "https://site.test/gate" },
      "generic",
    ],
  ];

  it.each(positiveCases)("detects %s", (_label, input, provider) => {
    expect(detectBrowserChallenge(input)?.provider).toBe(provider);
  });

  const negativeCases: [string, { title?: string; url?: string }][] = [
    [
      "normal app page",
      { title: "Dashboard", url: "https://app.example.com/dashboard" },
    ],
    ["empty input", {}],
    [
      "blog post that merely mentions captchas",
      {
        title: "How CAPTCHAs work",
        url: "https://blog.test/captcha-explained",
      },
    ],
    [
      "google search results (not recaptcha)",
      {
        title: "cats - Google Search",
        url: "https://www.google.com/search?q=cats",
      },
    ],
    ["unparseable url", { title: "Home", url: "not a url" }],
  ];

  it.each(negativeCases)("returns null for %s", (_label, input) => {
    expect(detectBrowserChallenge(input)).toBeNull();
  });
});

describe("browserChallengeAdvisory", () => {
  it("names the provider and directs a hand-off to the user", () => {
    expect(
      browserChallengeAdvisory({ provider: "cloudflare" }),
    ).toMatchInlineSnapshot(
      `"[agent-browser] This page looks like a Cloudflare verification / bot challenge, which requires a human and cannot be solved programmatically -- clicking, typing, or re-snapshotting will not pass it. Ask the user to complete the verification in the browser panel, then continue once it clears (for example \`agent-browser wait --url "**/<expected-path>"\` or re-run \`agent-browser snapshot -i\`). Do not keep retrying automatically."`,
    );
  });
});
