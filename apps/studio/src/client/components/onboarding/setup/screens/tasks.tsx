import {
  SetupHead,
  SetupPage,
  SetupPill,
} from "@/client/components/onboarding/setup/chrome";
import { useSetup } from "@/client/components/onboarding/setup/context";
import { PlaceholderPage } from "@/client/components/onboarding/setup/screens/placeholder";

/** F13 to F15: suggested tasks, or starter tasks when writing them fails. */
export function TasksPage() {
  return (
    <PlaceholderPage
      next="all-set"
      title="We picked a few tasks that might be useful"
    />
  );
}

/** F16: one line and one button into the app. */
export function AllSetPage() {
  const { finish, state } = useSetup();
  const { firstName } = state.answers;
  return (
    <SetupPage back={false}>
      <SetupHead
        title={firstName ? `You're all set, ${firstName}` : "You're all set"}
      />
      <SetupPill className="mt-8" onClick={finish} size="large">
        Open Instrument
      </SetupPill>
    </SetupPage>
  );
}
