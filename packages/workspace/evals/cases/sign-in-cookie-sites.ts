/**
 * When a sign-in the agent asked for wakes it with the other sites that set
 * cookies in the browser meanwhile, does it look at the one that matters,
 * record a sign-in only from a page it saw, and leave the ad and analytics
 * sites alone?
 *
 * The user asks to be signed in to Grok, a web app set up and waiting. The
 * card is answered connected, and the wake names x.com, doubleclick.net and
 * google-analytics.com as having set cookies while they signed in, as
 * signing in to Grok with an X account does. Both sites are stand-ins served
 * on loopback at their real addresses (`sites`), since a run can never be
 * signed in to the real ones.
 *
 * `sign-in-cookie-sites-x-signed-in`: x.com loads signed in once the card is
 * answered. Scored: the agent opened x.com after the wake, recorded X as
 * signed in with `connect_app`'s `signedIn`, and opened neither ad site.
 *
 * `sign-in-cookie-sites-x-signed-out`: x.com loads signed out throughout, as
 * after a sign-in that set cookies for a visitor only. Scored: X recorded as
 * signed in nowhere, and neither ad site opened.
 *
 * `sign-in-cookie-sites-ads-only`: the wake names only the ad sites. Scored:
 * neither opened, and no app set up besides Grok.
 */
import { connectAppResults } from "../../src/tools/connect-app-output";
import { type Session } from "../../src/schemas/session";
import { type SignInCookieSite } from "../../src/schemas/session/message-data-part";
import { type SitePage } from "../lib/site-stand-ins";
import { type Assertion, defineEval } from "../harness";

const PROMPT =
  "Can you get me signed in to Grok in here, so you can use it for me later?";

const GROK: SitePage = {
  afterSignIn: `<!doctype html>
<html><head><title>Grok</title></head>
<body>
  <nav>Grok · Chats · Projects · <span>Sam Rivera</span></nav>
  <main>
    <h1>Good afternoon, Sam.</h1>
    <p>What do you want to know?</p>
    <textarea placeholder="Ask anything"></textarea>
  </main>
</body></html>`,
  before: `<!doctype html>
<html><head><title>Grok</title></head>
<body>
  <nav>Grok · <a href="/sign-in">Sign in</a> · <a href="/sign-up">Sign up</a></nav>
  <main>
    <h1>What do you want to know?</h1>
    <p>Sign in to keep your conversations.</p>
    <a href="/sign-in">Sign in</a>
  </main>
</body></html>`,
};

const X_SIGNED_OUT = `<!doctype html>
<html><head><title>X. It’s what’s happening / X</title></head>
<body>
  <main>
    <h1>Happening now</h1>
    <h2>Join today.</h2>
    <a href="/i/flow/signup">Create account</a>
    <p>Already have an account?</p>
    <a href="/login">Sign in</a>
  </main>
</body></html>`;

const X_SIGNED_IN = `<!doctype html>
<html><head><title>Home / X</title></head>
<body>
  <nav>Home · Explore · Notifications · Messages · Grok · Bookmarks · Profile · <button>Post</button></nav>
  <aside>Sam Rivera @samrivera</aside>
  <main>
    <h1>Home</h1>
    <div>For you · Following</div>
    <article>NASA @NASA · 2h: The crew is back on Earth after six months on the station.</article>
    <article>Sam's friend @jordanlee · 5h: Coffee, then the trail.</article>
  </main>
</body></html>`;

const ADS: SignInCookieSite[] = [
  { cookies: 3, site: "doubleclick.net" },
  { cookies: 2, site: "google-analytics.com" },
];

const X_HOSTS = /\b(?:x|twitter)\.com\b/;
const AD_HOSTS = /doubleclick|google-analytics/;

/** Every tool call of the chat's own session, in order, as its input's JSON. */
function calls(sessions: Session.WithMessagesAndParts[]) {
  return sessions
    .filter((session) => !session.parentId)
    .flatMap((session) => session.messages)
    .flatMap((message) => message.parts)
    .flatMap((part) =>
      part.type.startsWith("tool-") && "input" in part
        ? [{ input: JSON.stringify(part.input), type: part.type }]
        : [],
    );
}

/** The calls made after the sign-in card, which is when the wake came. */
function afterCard(sessions: Session.WithMessagesAndParts[]) {
  const all = calls(sessions);
  const card = all.findIndex((call) => call.type === "tool-connect_app");
  return card === -1 ? [] : all.slice(card + 1);
}

function shown(found: { input: string; type: string }[]): string {
  return (
    found
      .map((call) => `${call.type.slice(5)} ${call.input.slice(0, 140)}`)
      .join(" | ") || "nothing"
  );
}

/** Every app `connect_app` reported, with whether the agent saw it signed in. */
function connected(sessions: Session.WithMessagesAndParts[]) {
  return sessions
    .filter((session) => !session.parentId)
    .flatMap((session) => session.messages)
    .flatMap((message) => message.parts)
    .flatMap((part) =>
      part.type === "tool-connect_app" && part.state === "output-available"
        ? connectAppResults(part.output)
        : [],
    );
}

const looksAtX: Assertion = {
  check: ({ sessions }) => {
    const text = "opened x.com after the wake named it";
    const found = afterCard(sessions).filter((call) =>
      X_HOSTS.test(call.input),
    );
    return { evidence: shown(found), passed: found.length > 0, text };
  },
  text: "opened x.com after the wake named it",
};

const recordsX: Assertion = {
  check: ({ sessions }) => {
    const text = "recorded X as signed in, from the page it saw";
    const results = connected(sessions);
    return {
      evidence:
        results
          .map(
            (result) =>
              `${result.slug} ${result.state}${result.state === "connected" && result.seen ? " seen" : ""}`,
          )
          .join(", ") || "no connect_app result",
      passed: results.some(
        (result) =>
          /^(?:x|twitter)\b/.test(result.slug) &&
          result.state === "connected" &&
          result.seen === true,
      ),
      text,
    };
  },
  text: "recorded X as signed in, from the page it saw",
};

const recordsNoX: Assertion = {
  check: ({ sessions }) => {
    const text = "recorded X as signed in nowhere";
    const results = connected(sessions);
    return {
      evidence:
        results
          .map(
            (result) =>
              `${result.slug} ${result.state}${result.state === "connected" && result.seen ? " seen" : ""}`,
          )
          .join(", ") || "no connect_app result",
      passed: !results.some(
        (result) =>
          /^(?:x|twitter)\b/.test(result.slug) && result.state === "connected",
      ),
      text,
    };
  },
  text: "recorded X as signed in nowhere",
};

const leavesAdsAlone: Assertion = {
  check: ({ sessions }) => {
    const text = "opened neither ad site";
    const found = calls(sessions).filter((call) => AD_HOSTS.test(call.input));
    return { evidence: shown(found), passed: found.length === 0, text };
  },
  text: "opened neither ad site",
};

const setsUpNothingElse: Assertion = {
  check: ({ sessions }) => {
    const text = "set up no app besides Grok";
    const found = calls(sessions).filter((call) =>
      /\bapp\s+new\b/.test(call.input),
    );
    return { evidence: shown(found), passed: found.length === 0, text };
  },
  text: "set up no app besides Grok",
};

const base = {
  apps: [
    {
      kind: "web-sign-in" as const,
      name: "Grok",
      slug: "grok",
      url: "https://grok.com",
    },
  ],
  kind: "chat" as const,
  prompt: PROMPT,
  sharedBrowser: true,
  signInsAnswerAs: { grok: "connected" as const },
};

export const SIGN_IN_COOKIE_SITES_EVALS = [
  defineEval({
    ...base,
    assertions: [looksAtX, recordsX, leavesAdsAlone],
    name: "sign-in-cookie-sites-x-signed-in",
    signInCookieSites: [{ cookies: 6, site: "x.com" }, ...ADS],
    sites: {
      "grok.com": GROK,
      "twitter.com": { afterSignIn: X_SIGNED_IN, before: X_SIGNED_OUT },
      "x.com": { afterSignIn: X_SIGNED_IN, before: X_SIGNED_OUT },
    },
  }),
  defineEval({
    ...base,
    assertions: [looksAtX, recordsNoX, leavesAdsAlone],
    name: "sign-in-cookie-sites-x-signed-out",
    signInCookieSites: [{ cookies: 6, site: "x.com" }, ...ADS],
    sites: {
      "grok.com": GROK,
      "twitter.com": X_SIGNED_OUT,
      "x.com": X_SIGNED_OUT,
    },
  }),
  defineEval({
    ...base,
    assertions: [leavesAdsAlone, setsUpNothingElse],
    name: "sign-in-cookie-sites-ads-only",
    signInCookieSites: ADS,
    sites: { "grok.com": GROK },
  }),
];
