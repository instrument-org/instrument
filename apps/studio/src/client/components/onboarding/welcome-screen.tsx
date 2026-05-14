import { ProviderSetupFlow } from "@/client/components/onboarding/provider-setup-flow";

export function OnboardingWelcomeScreen({
  error,
  isSetupComplete,
  onAddProvider,
  onContinue,
  onLogin,
}: {
  error?: Error | null;
  isSetupComplete: boolean;
  onAddProvider?: () => void;
  onContinue?: () => void;
  onLogin: () => Promise<void>;
}) {
  return (
    <ProviderSetupFlow
      error={error}
      isSetupComplete={isSetupComplete}
      onAddProvider={onAddProvider}
      onContinue={onContinue}
      onLogin={onLogin}
    />
  );
}
