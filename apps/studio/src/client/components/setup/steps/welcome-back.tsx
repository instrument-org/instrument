import { BrandMark } from "@/client/components/brand-mark";
import { Button } from "@/client/components/ui/button";
import { APP_NAME } from "@instrument-org/shared";

import { SetupPage } from "../kit/setup-page";
import { type SetupStepProps } from "../step-props";

/** Welcome back (frame 30), for someone who used a beta: no footer, and Get started answers it. */
export function WelcomeBackStep({ onContinue }: SetupStepProps) {
  return (
    <SetupPage
      className="pt-26.5"
      hero={<BrandMark className="mb-4" size={96} />}
      subtitle={`Thanks for testing it. Your chats and files are right where you left them. ${APP_NAME} now has its own plans, and it still works with the ChatGPT, Claude or Grok plan you pay for.`}
      title={`Welcome to the new ${APP_NAME}`}
    >
      <Button
        className="mt-8 h-10 px-8 text-base"
        onClick={onContinue}
        variant="brand"
      >
        Get started
      </Button>
    </SetupPage>
  );
}
