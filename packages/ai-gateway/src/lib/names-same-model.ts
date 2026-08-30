/**
 * Whether a provider's answer names the model the request named.
 *
 * Not string equality, because a provider may resolve an undated alias to the
 * dated build behind it: OpenAI answers a request for `gpt-5.6-luna` with
 * `gpt-5.6-luna-2026-01-15`, and Anthropic's `-latest` aliases behave the same
 * way. Those are one model pinned to a build, not a substitution, and treating
 * them as one would put a strikethrough on every turn a provider serves
 * normally. Anthropic's own catalog is dated already, so this matters wherever
 * a catalog carries the alias -- OpenAI's does.
 *
 * The suffix has to begin with a digit, which is what separates a build from a
 * different model. `gpt-5` answered by `gpt-5-mini` shares a prefix and is a
 * genuinely different model, so it is not the same model.
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

  return suffix === undefined ? false : /^\d/.test(suffix);
}
