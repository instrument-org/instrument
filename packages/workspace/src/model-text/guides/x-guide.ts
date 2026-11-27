import { APP_NAME } from "@instrument-org/shared";

import { APP_COMMAND } from "../commands/app-command";

/**
 * What an X app's guide says after its own, shipped with the build as an
 * MCP app's server says it about itself: what the X tools reach, the search
 * operators a query takes, and what is left to x.com. X documents none of
 * its operators; these are the ones 2026 references found still working on
 * x.com, and the location ones and `min_likes:`, which they found not to,
 * are named as not working.
 */
export function xToolsGuide(slug: string): string {
  return `${APP_NAME}'s own X tools, which every app on x.com has, run on the user's Grok plan signed in on this computer: each call is a request (a long search, several) on that plan, so ask once for what you need. \`${APP_COMMAND.name} tool ${slug} <name>\` shows the JSON a tool takes.
- search: posts matching a query, an account's latest (\`from\` alone), or both. \`sort\`: \`latest\` (newest first) or \`top\` (most engaged first).
- thread: the conversation around one post, oldest first: what it replies to, the post, its replies.
- people: accounts by name or by what they post about: handle, name, bio, link.
Every post and account they return is one X's search returned and cited, never one Grok wrote; an empty list means nothing was found.

\`query\` takes X's search operators, which combine: "exact phrase", a OR b, -word, (grouping), #hashtag, from:handle, to:handle, @handle, min_faves:N (likes; min_likes: does not work), min_retweets:N, min_replies:N, filter:media, filter:images, filter:videos, filter:links, filter:news, -filter:replies, -filter:retweets, filter:blue_verified, lang:xx, url:domain, list:<id>. near:, within: and geocode: no longer work.
\`from\` and \`exclude\` take up to 20 accounts each, without the @, and not both in one search: search the accounts you want rather than leaving some out.
\`since\` and \`until\` are whole days (YYYY-MM-DD, UTC), \`until\` included, and a post's \`date\` is its day.

Only x.com has the user's own timeline, notifications, bookmarks, likes, lists, DMs, trends, and posting: work those in a tab on x.com, signed in in ${APP_NAME}'s browser, where X's own account switcher has every account the user signed in to there.`;
}
