/**
 * Whether a provider's answer names the model the request named.
 *
 * Not string equality, because a provider may resolve an undated alias to the
 * dated build behind it: OpenAI answers a request for `gpt-5.6-luna` with
 * `gpt-5.6-luna-2026-01-15`. That is one model pinned to a build, not a
 * substitution, and treating it as one would put a strikethrough on every turn
 * a provider serves normally. Anthropic's own catalog is dated already, so this
 * matters wherever a catalog carries the alias -- OpenAI's does.
 *
 * The suffix has to be a build number and nothing else: digits, and the dashes
 * inside a date. A suffix carrying a letter names a different model, whether it
 * is a tier (`gpt-5` answered by `gpt-5-mini`), a parameter count (`llama-3.3`
 * answered by `llama-3.3-70b-instruct`) or a context window (`gpt-4` answered
 * by `gpt-4-32k`) -- the last two of which would pass on a leading digit alone.
 *
 * Only a served id longer than the requested one reads as a build. An alias
 * that resolves to something shorter or differently spelled, such as `-latest`
 * against the dated build behind it, shares no prefix and reads as a
 * substitution.
 */
export function namesSameModel(
  requestedProviderId: string | undefined,
  servedProviderId: string,
): boolean {
  if (requestedProviderId === undefined) {
    return false;
  }
  if (requestedProviderId === servedProviderId) {
    return true;
  }
  const suffix = servedProviderId.startsWith(`${requestedProviderId}-`)
    ? servedProviderId.slice(requestedProviderId.length + 1)
    : undefined;

  return suffix === undefined ? false : /^\d[\d-]*$/.test(suffix);
}
