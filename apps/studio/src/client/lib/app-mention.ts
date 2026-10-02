import { instrumentLinkOf } from "@/shared/instrument-link";
import { APP_NAME_SLUG } from "@instrument-org/shared";

/** An app named in a prompt: what it is called, and the slug its address carries. */
export interface AppMention {
  name: string;
  slug: string;
}

export type AppMentionSegment =
  | { app: AppMention; type: "app" }
  | { text: string; type: "text" };

// The Markdown link a reply writes for an app, which the transcript draws as
// a chip: the composer writes the same one, so an app named while writing
// and an app named in a reply are one thing on screen and to the model. The
// label is the app's name as the person reads it; the address is checked by
// the app's own link parser below, so only a link into the app matches.
const APP_LINK_PATTERN = /\[([^\]\n]+)\]\(([a-z][\w+.-]*:\/\/app\/[\w.:-]+)\)/g;

/** The wire form the composer serializes an app mention to. */
export function appMentionToken(app: AppMention) {
  return `[${app.name}](${APP_NAME_SLUG}://app/${app.slug})`;
}

/** Split one line into the apps it names and the text around them. */
export function splitAppMentions(line: string): AppMentionSegment[] {
  const segments: AppMentionSegment[] = [];
  let cursor = 0;
  for (const match of line.matchAll(APP_LINK_PATTERN)) {
    const [whole, name, href] = match;
    const link = href === undefined ? undefined : instrumentLinkOf(href);
    if (!name || link?.kind !== "app") {
      continue;
    }
    if (match.index > cursor) {
      segments.push({ text: line.slice(cursor, match.index), type: "text" });
    }
    segments.push({ app: { name, slug: link.name }, type: "app" });
    cursor = match.index + whole.length;
  }
  if (cursor < line.length) {
    segments.push({ text: line.slice(cursor), type: "text" });
  }
  return segments;
}
