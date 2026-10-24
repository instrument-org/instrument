const BARE_COMPARE_URL =
  /(^|\s)(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/compare\/([\w./-]+?)\.\.\.([\w./-]+))(?=\s|$)/gm;

const shortRef = (ref: string) =>
  /^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref;

/**
 * Labels each bare GitHub compare URL in Markdown with its range, the way
 * GitHub draws one: `v1.0.0...v1.1.0`, or `02fb11b...88db536` for commits.
 * A bare URL is one unbreakable word, too long for a release note's line.
 */
export function shortenCompareLinks(markdown: string): string {
  return markdown.replace(
    BARE_COMPARE_URL,
    (_match, lead: string, url: string, base: string, head: string) =>
      `${lead}[${shortRef(base)}...${shortRef(head)}](${url})`,
  );
}
