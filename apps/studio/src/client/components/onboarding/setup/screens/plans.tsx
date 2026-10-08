import { PlaceholderPage } from "@/client/components/onboarding/setup/screens/placeholder";

/** F3: the plans, each with a free trial. */
export function PlansPage() {
  return (
    <PlaceholderPage
      next="trial-started"
      title="Try Instrument free for 7 days"
    />
  );
}

/** F4: the trial is running. */
export function TrialStartedPage() {
  return <PlaceholderPage next="memories" title="Your trial has started" />;
}

/** F29: a returning beta tester, already signed in. */
export function WelcomeBackPage() {
  return (
    <PlaceholderPage next="beta-offer" title="Welcome to the new Instrument" />
  );
}

/** F30: the beta tester's offer, when the API makes one. */
export function BetaOfferPage() {
  return (
    <PlaceholderPage
      next="memories"
      title="Instrument Plus is on us for 3 months"
    />
  );
}
