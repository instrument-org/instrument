import { AppIconStylized } from "@/client/components/app-icon-stylized";
import { Button } from "@/client/components/ui/button";
import { APP_NAME } from "@instrument-org/shared";

export function OnboardingSuccessScreen({
  onContinue,
}: {
  onContinue?: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-between overflow-hidden px-6 pt-20 pb-6">
      <div className="flex w-full flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-6">
          <AppIconStylized className="size-20" />

          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="font-serif text-3xl font-medium tracking-tight text-foreground">
              {`Welcome to ${APP_NAME}`}
            </h1>
            <p className="text-sm text-foreground/80">Let&apos;s begin.</p>
          </div>
        </div>

        <div className="flex w-full max-w-xs flex-col items-center gap-2.5">
          <Button onClick={onContinue} type="button" variant="default">
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
