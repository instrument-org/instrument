import { APP_COMMAND } from "../../model-text/commands/app-command";

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
