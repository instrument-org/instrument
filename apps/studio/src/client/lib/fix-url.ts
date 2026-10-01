// A paste can carry more than the address: a Markdown link (`[url](url)`), or a
// scheme typed in front of one already there (`https://https://…`). The last
// `http(s)://` in the text is the address meant.
const LAST_SCHEME = /https?:\/\/(?!.*https?:\/\/)/i;

// Link syntax and quotes left around the address by the paste.
const WRAPPING = /^[[(<"'`]+|[\])>"'`]+$/g;

export function fixURL(url: string): string {
  let normalized = url.trim();
  if (!normalized) {
    return normalized;
  }

  const lastScheme = LAST_SCHEME.exec(normalized);
  if (lastScheme) {
    normalized = normalized.slice(lastScheme.index);
  }
  normalized = normalized.replaceAll(WRAPPING, "");

  normalized = normalized.replaceAll("\\", "/");

  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = `https://${normalized}`;
  }

  normalized = normalized.replaceAll(/([^:]\/)\/+/g, "$1");

  if (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}
