/**
 * What typed words are when they are an address: a scheme, or a host with a
 * dot in it and no spaces, the way a browser's own box reads them.
 */
export function siteFromWords(
  words: string,
): undefined | { host: string; url: string } {
  if (!words || /\s/.test(words)) {
    return;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(words)
    ? words
    : /^[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:\/.*)?$/.test(words)
      ? `https://${words}`
      : undefined;
  if (!withScheme) {
    return;
  }
  try {
    const url = new URL(withScheme);
    return { host: url.host, url: url.href };
  } catch {
    return;
  }
}
