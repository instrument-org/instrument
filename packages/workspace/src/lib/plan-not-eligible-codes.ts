/**
 * Provider codes for an account that is signed in but whose plan can't be
 * used here: a free or lapsed ChatGPT plan, a workspace that turned other
 * apps off, or a sign-in that left plan access out. Signing in again doesn't
 * fix any of them.
 */
export const PLAN_NOT_ELIGIBLE_CODES: ReadonlySet<string> = new Set([
  "chatpass_v2_scope_not_authorized",
  "subscription_sharing_invalid_user",
  "subscription_sharing_user_not_eligible",
]);
