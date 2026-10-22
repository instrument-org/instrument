import { APP_NAME } from "@instrument-org/shared";

import { APP_COMMAND } from "../shell-commands/app-command";

/**
 * Signing in on the service's own site in the window's browser, where its
 * cookies keep the sign-in: the way in that is left when a direct sign-in is
 * refused, fails, or is given up on. These name it for an app set up another
 * way; a web app has nowhere further to go.
 */

/** The command that moves an app over to signing in on the web. */
export function webInsteadCommand(slug: string, url: string | undefined) {
  return `${APP_COMMAND.name} new ${slug} --web ${url ?? "<the service's site>"} --force`;
}

/**
 * The next step, as a sentence for the agent: move the app to the web and ask
 * with `connect_app`, whose card opens the site in the window's browser.
 */
export function webInsteadStep(slug: string, url: string | undefined): string {
  return `Next, sign in on the web in ${APP_NAME}'s browser: \`${webInsteadCommand(slug, url)}\`, then connect_app; its card opens the site, and the app is worked in a tab there.`;
}
