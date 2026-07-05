import { BrandMark } from "@/client/components/brand-mark";
import { OnboardingScreen } from "@/client/components/onboarding/screen";
import { Button } from "@/client/components/ui/button";
import { APP_NAME } from "@instrument-org/shared";
import { motion } from "motion/react";

const initial = { opacity: 0 };
const animate = { opacity: 1 };
const fade = { duration: 0.4, ease: "easeOut" as const };

export function OnboardingSuccessScreen({
  onContinue,
}: {
  onContinue?: () => void;
}) {
  return (
    <OnboardingScreen>
      <div className="flex w-full flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-6">
          <motion.div
            animate={animate}
            initial={initial}
            transition={{ ...fade, delay: 0.5 }}
          >
            <BrandMark className="size-20 drop-shadow-md" />
          </motion.div>

          <motion.div
            animate={animate}
            className="flex flex-col items-center gap-2 text-center"
            initial={initial}
            transition={{ ...fade, delay: 0.575 }}
          >
            <h1 className="font-serif text-3xl font-medium tracking-tight text-foreground">
              {`Welcome to ${APP_NAME}`}
            </h1>
            <p className="text-sm text-foreground/80">Let&apos;s begin.</p>
          </motion.div>
        </div>

        <motion.div
          animate={animate}
          className="flex w-full max-w-xs flex-col items-center gap-2.5"
          initial={initial}
          transition={{ ...fade, delay: 0.65 }}
        >
          <Button onClick={onContinue} type="button" variant="default">
            Continue
          </Button>
        </motion.div>
      </div>
    </OnboardingScreen>
  );
}
