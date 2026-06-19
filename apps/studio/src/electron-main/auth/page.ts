import { APP_NAME, APP_PROTOCOL, SUPPORT_URL } from "@instrument-org/shared";
import { html, raw } from "hono/html";

// Light mode: dark text on warm gradient. Dark mode: white text on dark gradient.
const defaultBtn = [
  "inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5",
  "text-sm font-medium whitespace-nowrap transition-all outline-none h-10 min-w-36",
  "bg-white text-stone-900 shadow-sm hover:bg-stone-100",
  "dark:bg-stone-200 dark:text-stone-900 dark:hover:bg-stone-300",
].join(" ");

const outlineBtn = [
  "inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5",
  "text-sm font-medium whitespace-nowrap transition-all outline-none h-10 min-w-36",
  "text-black/50 hover:bg-black/5 hover:text-black/70",
  "dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/70",
].join(" ");

const button = (variant: "default" | "outline", href: string, label: string) =>
  html`<a
    class="${variant === "default" ? defaultBtn : outlineBtn}"
    href="${href}"
    >${label}</a
  >`;

const contactUsButton = button("outline", SUPPORT_URL, "Contact us");

export const testStates: { href: string; label: string }[] = [
  { href: "/test/success", label: "Success" },
  { href: "/test/error", label: "Error" },
];

interface AuthPageProps {
  /** When set, renders an index page listing links to each state. */
  indexHref?: string;
  isError?: boolean;
  states?: { href: string; label: string }[];
  title?: string;
}

export function renderAuthPage({
  indexHref,
  isError = false,
  states,
  title,
}: AuthPageProps = {}) {
  const renderContent = () => {
    if (indexHref && states) {
      return html` <h1
          class="auth-serif text-3xl font-medium tracking-tight text-center text-stone-900 dark:text-white"
        >
          Auth Page States
        </h1>
        <p class="text-sm text-stone-600 dark:text-white/60 text-center">
          Preview each state of the login callback page.
        </p>
        <div class="flex flex-col gap-3 w-full">
          ${states.map((s) => button("outline", s.href, s.label))}
        </div>`;
    }
    if (isError) {
      return html` <h1
          class="auth-serif text-3xl font-medium tracking-tight text-center text-stone-900 dark:text-white"
        >
          There was an error signing in.
        </h1>
        <p class="text-sm text-stone-600 dark:text-white/60 text-center">
          Please try again or contact us if the issue persists.
        </p>
        <div class="flex gap-3">
          ${contactUsButton}
          ${button("default", `${APP_PROTOCOL}://`, `Open ${APP_NAME}`)}
        </div>`;
    }
    return html` <h1
        class="auth-serif text-3xl font-medium tracking-tight text-center text-stone-900 dark:text-white"
      >
        You're signed in
      </h1>
      <p class="text-sm text-stone-600 dark:text-white/60 text-center">
        You may close this window and open ${APP_NAME}
      </p>
      <div class="flex gap-3">
        ${button("default", `${APP_PROTOCOL}://home`, `Open ${APP_NAME}`)}
      </div>`;
  };

  return html`<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" href="/favicon.ico" type="image/x-icon" />
        <script src="/tailwind.js"></script>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link
          href="https://fonts.googleapis.com/css2?family=Roboto+Serif:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <style>
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
        <div
          class="flex min-h-svh flex-col items-center justify-center gap-8 p-6"
        >
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
                '<p class="text-3xl font-bold auth-serif text-stone-900 dark:text-white">' +
                ${raw(JSON.stringify(APP_NAME))} +
                "</p>";
            });
        </script>
      </body>
    </html>`;
}
