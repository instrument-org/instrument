import { APP_NAME, APP_PROTOCOL, SUPPORT_URL } from "@instrument-org/shared";
import { html, raw } from "hono/html";
import { randomBytes } from "node:crypto";

/** Who the user signed in to or connected: the name it goes by, and its mark as an image address when there is one. */
interface AuthService {
  mark?: string;
  name: string;
}

/**
 * How a sign-in that came back through the browser ended, as the page the
 * browser lands on tells it.
 */
export type AuthOutcome =
  /** Signed in to Instrument itself. */
  | { email?: string; kind: "signed-in"; service: AuthService }
  /** A provider or an app is connected. */
  | { email?: string; kind: "connected"; service: AuthService }
  /**
   * The user said no on the service's own page: to connecting it, or with
   * `signIn`, to signing in with it. `headline` when what was declined was
   * narrower than canceling.
   */
  | {
      headline?: string;
      kind: "declined";
      service: AuthService;
      signIn?: boolean;
    }
  /** The link matches no sign-in waiting for it: an old tab, a second visit, or the app restarted. */
  | { kind: "expired" }
  /** The service said yes and the rest went wrong. `connecting` names what was being connected; absent, it was signing in. */
  | { connecting?: string; kind: "failed"; reference: string };

/** A short code for a failure, logged with it, that the page shows in small print for support. */
export function newAuthReference() {
  return `AUTH-${randomBytes(3).toString("hex").toUpperCase()}`;
}

const svgDataUri = (svg: string) =>
  `data:image/svg+xml,${encodeURIComponent(svg)}`;

export const GOOGLE_MARK = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/><path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/><path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/><path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/></svg>`,
);

export const OPENAI_MARK = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#0d0d0d" d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>`,
);

export const OPENROUTER_MARK = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#0d0d0d" fill-rule="evenodd" d="M18.654 3.87a5.087 5.087 0 110 10.174L23.7 19.09c.64.641.187 1.737-.72 1.737H8.48a8.479 8.479 0 010-16.958h10.175zM8.479 7.26a5.087 5.087 0 100 10.176 5.087 5.087 0 000-10.175z"/></svg>`,
);

// Phosphor's regular weight, drawn in the text color.
const glyph = (path: string, cls: string) =>
  html`<svg
    class="${cls}"
    viewBox="0 0 256 256"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="${path}" />
  </svg>`;
const ARROWS_LEFT_RIGHT =
  "M213.66,181.66l-32,32a8,8,0,0,1-11.32-11.32L188.69,184H48a8,8,0,0,1,0-16H188.69l-18.35-18.34a8,8,0,0,1,11.32-11.32l32,32A8,8,0,0,1,213.66,181.66Zm-139.32-64a8,8,0,0,0,11.32-11.32L67.31,88H208a8,8,0,0,0,0-16H67.31L85.66,53.66A8,8,0,0,0,74.34,42.34l-32,32a8,8,0,0,0,0,11.32Z";
const CLOCK_COUNTDOWN =
  "M232,136.66A104.12,104.12,0,1,1,119.34,24,8,8,0,0,1,120.66,40,88.12,88.12,0,1,0,216,135.34,8,8,0,0,1,232,136.66ZM120,72v56a8,8,0,0,0,8,8h56a8,8,0,0,0,0-16H136V72a8,8,0,0,0-16,0Zm40-24a12,12,0,1,0-12-12A12,12,0,0,0,160,48Zm36,24a12,12,0,1,0-12-12A12,12,0,0,0,196,72Zm24,36a12,12,0,1,0-12-12A12,12,0,0,0,220,108Z";
const WARNING_CIRCLE =
  "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm-8-80V80a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,172Z";

const baseBtn = [
  "inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5",
  "text-sm font-medium whitespace-nowrap transition-all outline-none h-10 min-w-44",
].join(" ");

const btnClass = {
  primary: [
    baseBtn,
    "bg-white text-stone-900 shadow-sm hover:bg-stone-100",
    "dark:bg-stone-200 dark:text-stone-900 dark:hover:bg-stone-300",
  ].join(" "),
  secondary: [
    baseBtn,
    "bg-black/5 text-stone-700 hover:bg-black/10 hover:text-stone-900",
    "dark:bg-white/10 dark:text-white/80 dark:hover:bg-white/15 dark:hover:text-white",
  ].join(" "),
};

const button = (variant: keyof typeof btnClass, href: string, label: string) =>
  html`<a class="${btnClass[variant]}" href="${href}">${label}</a>`;

// Every page's one way back. A bare address brings the window forward and
// leaves it on whatever it shows, which for an app sign-in is the chat that
// asked for it.
const openApp = button("primary", `${APP_PROTOCOL}://`, `Open ${APP_NAME}`);

const heading = (text: string) =>
  html`<h1
    class="auth-serif text-3xl font-normal tracking-tight text-center text-stone-900 dark:text-white"
  >
    ${text}
  </h1>`;

const subline = (text: string) =>
  html`<p
    class="max-w-md text-sm leading-relaxed text-stone-600 dark:text-white/60"
  >
    ${text}
  </p>`;

const appMark = (size: "size-16" | "size-20") =>
  html`<img
    data-app-mark
    src="/app-icon-stylized.png"
    alt="${APP_NAME}"
    class="${size} drop-shadow-md"
  />`;

const serviceMark = (service: AuthService, extra = "") =>
  service.mark
    ? html`<img
        src="${service.mark}"
        alt="${service.name}"
        class="size-16 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5 ${extra}"
      />`
    : "";

// Instrument and the service side by side, for a connection between them.
const pairedMarks = (service: AuthService) =>
  service.mark
    ? html`<div class="auth-meet flex items-center gap-3">
        ${appMark("size-16")}
        ${glyph(ARROWS_LEFT_RIGHT, "size-5 text-stone-400 dark:text-white/40")}
        ${serviceMark(service)}
      </div>`
    : appMark("size-20");

const accountChip = (email: string, service: AuthService) =>
  html`<div
    class="flex items-center gap-2.5 rounded-full border border-stone-900/10 py-1.5 pr-4 pl-1.5 text-sm text-stone-800 dark:border-white/15 dark:text-white/85"
  >
    ${
      service.mark
        ? html`<img
            src="${service.mark}"
            alt=""
            class="size-7 rounded-full bg-white p-1.5 ring-1 ring-black/10"
          />`
        : ""
    }
    <span>${email}</span>
  </div>`;

const group = (...children: unknown[]) =>
  html`<div class="flex flex-col items-center gap-5">${children}</div>`;

// A success page's button sits further down than the others, past the
// account it names.
const openAppSpaced = html`<div class="pt-6">${openApp}</div>`;

// A failure's reference rides along in small print, for support to match
// against the logged error; nobody is asked to do anything with it.
const supportFooter = (reference?: string) => html`<div
  class="absolute inset-x-0 bottom-6 flex flex-col items-center gap-1 text-center text-xs text-stone-500 dark:text-white/45"
>
  <p>
    Need help?
    <a
      class="underline decoration-stone-300 underline-offset-4 hover:text-stone-900 dark:decoration-white/25 dark:hover:text-white"
      href="${SUPPORT_URL}"
      >Contact support</a
    >
  </p>
  ${
    reference
      ? html`<p class="font-mono text-stone-400 dark:text-white/30">
          ${reference}
        </p>`
      : ""
  }
</div>`;

function renderOutcome(outcome: AuthOutcome) {
  switch (outcome.kind) {
    case "signed-in": {
      return {
        arrive: true,
        body: html`${appMark("size-20")}
        ${group(
          heading("You're signed in"),
          outcome.email ? accountChip(outcome.email, outcome.service) : "",
        )}
        ${openAppSpaced}`,
        title: "Signed in",
      };
    }
    case "connected": {
      const { email, service } = outcome;
      return {
        arrive: true,
        body: html`${pairedMarks(service)}
        ${group(
          heading(`${service.name} is connected`),
          email ? accountChip(email, service) : "",
        )}
        ${openAppSpaced}`,
        title: `${service.name} connected`,
      };
    }
    case "declined": {
      const { headline, service, signIn } = outcome;
      return {
        body: html`${
          service.mark ? serviceMark(service, "opacity-60") : appMark("size-20")
        }
        ${heading(
          headline ??
            (signIn
              ? "There was a problem signing in"
              : `There was a problem connecting to ${service.name}`),
        )}
        ${openApp}`,
        title: signIn ? "Sign-in canceled" : "Not connected",
      };
    }
    case "expired": {
      return {
        body: html`${glyph(
          CLOCK_COUNTDOWN,
          "size-12 text-stone-400 dark:text-white/40",
        )}
        ${heading("This sign-in link expired")} ${openApp}`,
        title: "Link expired",
      };
    }
    case "failed": {
      const { connecting, reference } = outcome;
      return {
        body: html`${glyph(
          WARNING_CIRCLE,
          "size-12 text-stone-400 dark:text-white/40",
        )}
        ${heading(
          connecting
            ? `There was a problem connecting to ${connecting}`
            : "There was a problem signing in",
        )}
        ${openApp}`,
        reference,
        title: "Sign-in failed",
      };
    }
  }
}

/**
 * Sample outcomes, for previewing each page without signing in. `sampleMark`
 * is the sample app's mark, which the caller looks up the way a real sign-in does.
 */
export const previewOutcomes = (
  sampleMark?: string,
): { label: string; outcome: AuthOutcome }[] => [
  {
    label: "Signed in",
    outcome: {
      email: "alex@example.com",
      kind: "signed-in",
      service: { mark: GOOGLE_MARK, name: "Google" },
    },
  },
  {
    label: "ChatGPT connected",
    outcome: {
      email: "alex@example.com",
      kind: "connected",
      service: { mark: OPENAI_MARK, name: "ChatGPT" },
    },
  },
  {
    label: "App connected",
    outcome: {
      kind: "connected",
      service: { mark: sampleMark, name: "Linear" },
    },
  },
  {
    label: "Declined",
    outcome: {
      kind: "declined",
      service: { mark: sampleMark, name: "Linear" },
    },
  },
  { label: "Expired", outcome: { kind: "expired" } },
  {
    label: "Failed",
    outcome: {
      connecting: "ChatGPT",
      kind: "failed",
      reference: "AUTH-7F3K2Q",
    },
  },
];

function renderIndex(links: { href: string; label: string }[]) {
  return {
    body: html`${appMark("size-20")}
      ${group(
        heading("Auth Page States"),
        subline("Preview each page the browser lands on after a sign-in."),
      )}
      <div class="flex flex-col gap-2">
        ${links.map((l) => button("secondary", l.href, l.label))}
      </div>`,
    title: "Auth Page Preview",
  };
}

export function renderAuthPage(
  page: AuthOutcome | { index: { href: string; label: string }[] },
) {
  const {
    arrive,
    body,
    reference,
    title,
  }: { arrive?: boolean; body: unknown; reference?: string; title: string } =
    "index" in page ? renderIndex(page.index) : renderOutcome(page);

  return html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" href="/favicon.ico" type="image/png" />
        <link rel="apple-touch-icon" href="/icon.png" />
        <script src="/tailwind.js"></script>
        <style>
          @font-face {
            font-family: "Roboto Serif";
            font-weight: 400;
            font-display: swap;
            src: url("/fonts/roboto-serif-400.woff2") format("woff2");
          }
          .auth-serif {
            font-family: "Roboto Serif", ui-serif, Georgia, serif;
          }
          /* brandGradient light: --brand-100 → --brown-50 */
          html {
            background: linear-gradient(180deg, #c5d5d0 0%, #fcfbf8 100%);
          }
          /* brandGradient dark: color-mix(--brand-700 50%, --background) → --background */
          @media (prefers-color-scheme: dark) {
            html {
              background: linear-gradient(
                180deg,
                color-mix(in srgb, #0a4a42 50%, #09090b) 0%,
                #09090b 50%
              );
            }
          }
          /* A success page arrives: the mark pops in (two marks slide together and the arrows pop), then the rest rises in. */
          @media (prefers-reduced-motion: no-preference) {
            .auth-arrive > * {
              animation: auth-rise 450ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
            }
            .auth-arrive > :nth-child(2) {
              animation-delay: 160ms;
            }
            .auth-arrive > :nth-child(n + 3) {
              animation-delay: 260ms;
            }
            .auth-arrive > :first-child {
              animation: auth-pop 520ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
            }
            .auth-arrive > .auth-meet {
              animation: none;
            }
            .auth-meet > * {
              animation: auth-pop 520ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
            }
            .auth-meet > :first-child {
              --from: -28px;
            }
            .auth-meet > :last-child {
              --from: 28px;
            }
            .auth-meet > :nth-child(2) {
              animation-delay: 240ms;
            }
          }
          @keyframes auth-pop {
            from {
              opacity: 0;
              transform: translateX(var(--from, 0)) scale(0.6);
            }
          }
          @keyframes auth-rise {
            from {
              opacity: 0;
              transform: translateY(8px);
            }
          }
        </style>
        <title>
          ${title} · ${APP_NAME}
        </title>
      </head>
      <body class="min-h-svh">
        <main
          class="${arrive ? "auth-arrive " : ""}relative flex min-h-svh flex-col items-center justify-center gap-6 px-6 pt-6 pb-20 text-center"
        >
          ${body} ${supportFooter(reference)}
        </main>
        <script>
          for (const mark of document.querySelectorAll("[data-app-mark]")) {
            mark.addEventListener("error", function () {
              const name = document.createElement("p");
              name.className =
                "text-3xl font-normal auth-serif text-stone-900 dark:text-white";
              name.textContent = ${raw(JSON.stringify(APP_NAME))};
              mark.replaceWith(name);
            });
          }
        </script>
      </body>
    </html>
  `;
}
