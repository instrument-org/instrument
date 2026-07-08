// Recognizes when a page is an automated bot/security challenge (Cloudflare
// interstitial, Turnstile, hCaptcha, reCAPTCHA) rather than real content. These
// walls require a human: the agent can't solve them, and their accessibility
// snapshot is nearly empty, so without a hint the agent tends to re-`snapshot`
// or re-`click` in a loop and burn turns. When one is detected after a
// navigation/interaction command we append a hand-off advisory to the
// agent-browser output so the model asks the user to clear it in the (same,
// live) browser panel instead.

export interface BrowserChallenge {
  provider: BrowserChallengeProvider;
}

export type BrowserChallengeProvider =
  | "cloudflare"
  | "generic"
  | "hcaptcha"
  | "recaptcha";

// Kept deliberately narrow to avoid false positives on ordinary pages that
// merely mention captchas or verification: only the well-known interstitial
// titles and hosted-challenge paths those providers actually serve.
const CLOUDFLARE_TITLE_SIGNALS = [
  "just a moment",
  "checking your browser",
  "checking if the site connection is secure",
];
const CLOUDFLARE_URL_SIGNALS = [
  "/cdn-cgi/challenge-platform/",
  "/cdn-cgi/l/chk_jschl",
];
const GENERIC_TITLE_SIGNALS = [
  "verify you are human",
  "verifying you are human",
  "are you a robot",
  "human verification",
  "please verify you are a human",
];

export function detectBrowserChallenge({
  title,
  url,
}: {
  title?: string;
  url?: string;
}): BrowserChallenge | null {
  const normalizedTitle = title?.toLowerCase().trim() ?? "";
  const normalizedUrl = url?.toLowerCase() ?? "";
  const host = hostFromUrl(url);

  if (
    CLOUDFLARE_URL_SIGNALS.some((signal) => normalizedUrl.includes(signal)) ||
    host === "challenges.cloudflare.com" ||
    host.endsWith(".challenges.cloudflare.com") ||
    CLOUDFLARE_TITLE_SIGNALS.some((signal) => normalizedTitle.includes(signal))
  ) {
    return { provider: "cloudflare" };
  }

  if (host === "hcaptcha.com" || host.endsWith(".hcaptcha.com")) {
    return { provider: "hcaptcha" };
  }

  // Standalone reCAPTCHA challenge pages are rare, but the hosted widget is
  // served from google.com/recaptcha; scope to that path so an ordinary
  // google.com page (e.g. a search results page) never trips this.
  if (
    (host === "www.google.com" || host === "google.com") &&
    normalizedUrl.includes("/recaptcha/")
  ) {
    return { provider: "recaptcha" };
  }

  if (
    GENERIC_TITLE_SIGNALS.some((signal) => normalizedTitle.includes(signal))
  ) {
    return { provider: "generic" };
  }

  return null;
}

const PROVIDER_LABELS: Record<BrowserChallengeProvider, string> = {
  cloudflare: "Cloudflare verification / bot challenge",
  generic: "human-verification challenge",
  hcaptcha: "hCaptcha challenge",
  recaptcha: "reCAPTCHA challenge",
};

export function browserChallengeAdvisory(challenge: BrowserChallenge): string {
  const label = PROVIDER_LABELS[challenge.provider];
  return [
    `[agent-browser] This page looks like a ${label}, which requires a human and cannot be solved programmatically -- clicking, typing, or re-snapshotting will not pass it.`,
    'Ask the user to complete the verification in the browser panel, then continue once it clears (for example `agent-browser wait --url "**/<expected-path>"` or re-run `agent-browser snapshot -i`).',
    "Do not keep retrying automatically.",
  ].join(" ");
}

function hostFromUrl(url: string | undefined): string {
  if (!url) {
    return "";
  }
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
