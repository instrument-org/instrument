import { PlaceholderPage } from "@/client/components/onboarding/setup/screens/placeholder";

/** F2: the four ways in. */
export function WelcomePage() {
  return (
    <PlaceholderPage
      links={[
        { label: "Continue with Google", step: "plans" },
        { label: "ChatGPT", step: "free-account" },
        { label: "Claude", step: "claude-sign-in" },
        { label: "Or add an API provider manually", step: "providers" },
      ]}
      title="Welcome to Instrument"
    />
  );
}

/** F18: the free Instrument account, offered after any way in but Google. */
export function FreeAccountPage() {
  return (
    <PlaceholderPage next="memories" title="Add a free Instrument account" />
  );
}

/** F19: the ChatGPT or Claude account has no paid plan. */
export function NoPaidPlanPage() {
  return (
    <PlaceholderPage title="Your ChatGPT account doesn't have a paid plan" />
  );
}

/** F20: the plan is out of usage as they connect it. */
export function OutOfUsagePage() {
  return (
    <PlaceholderPage next="memories" title="ChatGPT is out of usage for now" />
  );
}

/** F21: waiting on Claude's sign-in in the browser. */
export function ClaudeSignInPage() {
  return (
    <PlaceholderPage
      links={[
        { label: "Signing in on another device?", step: "claude-device" },
      ]}
      next="free-account"
      title="Finish signing in to Claude"
    />
  );
}

/** F22: Claude's sign-in link and code, for another device. */
export function ClaudeDevicePage() {
  return (
    <PlaceholderPage next="free-account" title="Sign in on another device" />
  );
}
