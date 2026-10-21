import { ConnectButton } from "@/client/components/connect-button";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { GlobeSimpleIcon } from "@phosphor-icons/react/GlobeSimple";
import { MicrophoneIcon } from "@phosphor-icons/react/Microphone";
import { SparkleIcon } from "@phosphor-icons/react/Sparkle";
import { type ReactNode } from "react";

import { SetupFooter, SetupPage } from "../kit/setup-page";
import { type SetupPageProps } from "../setup-pages";

const PERKS: { icon: ReactNode; line: string; tint: string; title: string }[] =
  [
    {
      icon: <GlobeSimpleIcon />,
      line: "Fast, up-to-date answers from the web",
      tint: "bg-brand-100 text-brand-800 dark:bg-brand-900/60 dark:text-brand-200",
      title: "Web search",
    },
    {
      icon: <MicrophoneIcon />,
      line: `Talk to ${APP_NAME} rather than typing`,
      tint: "bg-cyan-100 text-cyan-900 dark:bg-cyan-900/50 dark:text-cyan-200",
      title: "Dictation",
    },
    {
      icon: <SparkleIcon />,
      line: "Topics for new chats, and search that finds a chat by what it's about",
      tint: "bg-blue-100 text-blue-900 dark:bg-blue-900/50 dark:text-blue-200",
      title: "Smart suggestions",
    },
  ];

/**
 * The free Instrument account, offered once a subscription or a key has
 * brought the AI: what it adds, Google, or Not now. Signing in answers the
 * plan step too, since someone running on their own AI has no plan to pick.
 */
export function FreeAccountStep({ hold, onBack, onContinue }: SetupPageProps) {
  return (
    <SetupPage
      align="center"
      footer={
        <SetupFooter
          next="none"
          onBack={onBack}
          skip={{ label: "Not now", onClick: onContinue }}
        />
      }
      subtitle="Sign in with Google for a few extras that work with any AI. It's free, and it doesn't use your plan or your key."
      title={`Add a free ${APP_NAME} account`}
    >
      <div className="mt-8 flex max-w-full flex-wrap justify-center gap-1.5">
        {PERKS.map((perk) => (
          <div
            className="flex w-57.5 flex-col gap-1 rounded-2xl border bg-card p-4"
            key={perk.title}
          >
            <span
              className={cn(
                "mb-3 flex size-9 items-center justify-center rounded-[11px] [&_svg]:size-5",
                perk.tint,
              )}
            >
              {perk.icon}
            </span>
            <p className="text-sm font-medium text-foreground">{perk.title}</p>
            <p className="text-xs text-muted-foreground">{perk.line}</p>
          </div>
        ))}
      </div>
      <div className="mt-8 w-80">
        <ConnectButton
          className="h-10 w-full text-base"
          onResult={(result) => {
            if (result.outcome.kind !== "ready") {
              return;
            }
            // The plan step comes before this one, and the account just
            // made would ask it; answered first, setup skips it.
            void rpcClient.setup.answer
              .call({ step: "plan" })
              .finally(onContinue);
          }}
          onWaitingChange={(waiting) => {
            if (waiting) {
              hold();
            }
          }}
          provider="instrument"
          variant="default"
        />
      </div>
    </SetupPage>
  );
}
