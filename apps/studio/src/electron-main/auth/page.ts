import { APP_NAME, APP_PROTOCOL, SUPPORT_URL } from "@instrument-org/shared";
import { html, raw } from "hono/html";

// Light mode: dark text on warm gradient. Dark mode: white text on dark gradient.
const baseBtn = [
  "inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5",
  "text-sm font-medium whitespace-nowrap transition-all outline-none h-10 min-w-44",
].join(" ");

const primaryBtn = [
  baseBtn,
  "bg-white text-stone-900 shadow-sm hover:bg-stone-100",
  "dark:bg-stone-200 dark:text-stone-900 dark:hover:bg-stone-300",
].join(" ");

const secondaryBtn = [
  baseBtn,
  "bg-black/5 text-stone-700 hover:bg-black/10 hover:text-stone-900",
  "dark:bg-white/10 dark:text-white/80 dark:hover:bg-white/15 dark:hover:text-white",
].join(" ");

const button = (
  variant: "primary" | "secondary",
  href: string,
  label: string,
) =>
  html`<a
    class="${variant === "primary" ? primaryBtn : secondaryBtn}"
    href="${href}"
    >${label}</a
  >`;

// Stacked, every button as wide as the widest, the primary one on top.
const actions = (buttons: ReturnType<typeof button>[]) =>
  html`<div class="mt-4 flex flex-col gap-2">${buttons}</div>`;

// Every page's headline, so they all set it the same way.
const heading = (text: string) =>
  html`<h1
    class="auth-serif text-3xl font-normal tracking-tight text-center text-stone-900 dark:text-white"
  >
    ${text}
  </h1>`;

const contactUsButton = button("secondary", SUPPORT_URL, "Contact us");

export const testStates: { href: string; label: string }[] = [
  { href: "/test/success", label: "Success" },
  { href: "/test/connected", label: "Connected" },
  { href: "/test/error", label: "Error" },
];

interface AuthPageProps {
  /** When set, renders an index page listing links to each state. */
  indexHref?: string;
  isError?: boolean;
  /** An app the user just signed in to, for a page that says so by name. */
  signedInTo?: string;
  states?: { href: string; label: string }[];
  title?: string;
}

export function renderAuthPage({
  indexHref,
  isError = false,
  signedInTo,
  states,
  title,
}: AuthPageProps = {}) {
  const renderContent = () => {
    if (indexHref && states) {
      return html`${heading("Auth Page States")}
        <p class="-mt-2 text-sm text-stone-600 dark:text-white/60 text-center">
          Preview each state of the login callback page.
        </p>
        ${actions(states.map((s) => button("secondary", s.href, s.label)))}`;
    }
    if (isError) {
      return html`${heading("There was an error signing in")}
        <p class="-mt-2 text-sm text-stone-600 dark:text-white/60 text-center">
          Please try again or contact us if the issue persists.
        </p>
        ${actions([
          button("primary", `${APP_PROTOCOL}://`, `Open ${APP_NAME}`),
          contactUsButton,
        ])}`;
    }
    if (signedInTo) {
      return html`${heading(`${signedInTo} is connected`)}
      ${actions([
        button("primary", `${APP_PROTOCOL}://home`, `Back to ${APP_NAME}`),
      ])}`;
    }
    return html`${heading("You're signed in")}
    ${actions([
      button("primary", `${APP_PROTOCOL}://home`, `Open ${APP_NAME}`),
    ])}`;
  };

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
        </style>
        <title>${title ?? `Log in to ${APP_NAME}`}</title>
      </head>
      <body class="min-h-svh">
        <div class="flex min-h-svh flex-col items-center justify-center gap-8 p-6">
          <div id="icon-container" class="flex items-center justify-center">
            <img
              id="app-icon"
              src="/app-icon-stylized.png"
              alt="${APP_NAME}"
              class="size-20 drop-shadow-md"
            />
          </div>
          <div class="flex flex-col items-center gap-6 text-center">
            ${renderContent()}
          </div>
        </div>
        <script>
          document
            .getElementById("app-icon")
            .addEventListener("error", function () {
              document.getElementById("icon-container").innerHTML =
                '<p class="text-3xl font-normal auth-serif text-stone-900 dark:text-white">' +
                ${raw(JSON.stringify(APP_NAME))} +
                "</p>";
            });
        </script>
      </body>
    </html>
  `;
}
