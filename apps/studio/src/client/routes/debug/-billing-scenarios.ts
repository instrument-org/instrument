/**
 * The billing situations the platform's tooling can put a test account in,
 * each as a prompt for a coding agent in that repository. The agent finds the
 * matching scenario in `pnpm billing scenario list`, which is the real list:
 * a state added or removed there is added or removed here.
 */
export const billingScenarios = [
  {
    name: "fresh",
    state: "a new user on the free plan who hasn't started a trial",
  },
  { name: "trial", state: "partway through a free trial" },
  {
    name: "trial-ended",
    state: "back on the free plan after their trial ran out",
  },
  { name: "basic", state: "an active Basic subscriber" },
  { name: "pro", state: "an active Pro subscriber" },
  {
    name: "near-limit",
    state: "a Basic subscriber who has used 90% of their 5-hour limit",
  },
  {
    name: "out-of-usage",
    state: "a Basic subscriber who has used up their 5-hour limit",
  },
  { name: "past-due", state: "a subscriber whose renewal payment failed" },
  {
    name: "canceling",
    state:
      "a subscriber who canceled, with the plan running until the period ends",
  },
  {
    name: "downgrade-pending",
    state:
      "a Pro subscriber who chose to move down to Basic at the period's end",
  },
  {
    name: "revoked",
    state: "a subscriber whose payment was disputed, so hosted models are off",
  },
] as const;

export function billingScenarioPrompt({
  name,
  state,
}: (typeof billingScenarios)[number]) {
  return `In the internal repo, make me a test account on preview that is ${state} (the \`${name}\` billing scenario), then open Studio signed in as it.`;
}
