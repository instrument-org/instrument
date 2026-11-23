/**
 * Whether a reading of Claude Code's sign-in means the person was signed out
 * without asking. Claude Code says so ("expired") only until it drops a
 * sign-in Anthropic refused to renew; after that it reads the same as one that
 * was never there, so what was known before decides: an account that was
 * signed in, or already noted as lost, is still lost until a sign-in or the
 * person's own sign-out.
 */
export function lostClaudeSignIn({
  before,
  next,
  noted,
  signingOut,
}: {
  before: { kind: string };
  next: { expired?: boolean; kind: string };
  /** Already recorded as signed out without the person asking. */
  noted: boolean;
  /** The person's own sign-out is under way. */
  signingOut: boolean;
}): boolean {
  return (
    next.kind === "signed-out" &&
    !signingOut &&
    (next.expired === true || noted || before.kind === "signed-in")
  );
}
