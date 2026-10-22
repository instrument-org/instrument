import { ConnectButton } from "@/client/components/connect-button";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { GlobeSimpleIcon } from "@phosphor-icons/react/GlobeSimple";
import { ImageIcon } from "@phosphor-icons/react/Image";
import { MicrophoneIcon } from "@phosphor-icons/react/Microphone";
import { type ReactNode } from "react";

import { SetupFooter, SetupPage } from "../kit/setup-page";
import { type SetupPageProps } from "../setup-page-props";

const PERKS: { icon: ReactNode; line: string; tint: string; title: string }[] =
  [
    {
      icon: <GlobeSimpleIcon />,
      line: "Fast, up-to-date answers from the web",
      tint: "bg-setup-perk-search text-setup-perk-search-ink",
      title: "Web search",
    },
    {
      icon: <MicrophoneIcon />,
      line: `Talk to ${APP_NAME} rather than typing`,
      tint: "bg-setup-perk-dictation text-setup-perk-dictation-ink",
      title: "Dictation",
    },
    {
      icon: <ImageIcon />,
      line: "Make images in any chat with ChatGPT's image generation",
      tint: "bg-setup-perk-images text-setup-perk-images-ink",
      title: "Images",
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
      <div className="mt-7 flex max-w-full flex-wrap justify-center gap-1">
        {PERKS.map((perk) => (
          <div
            className="flex h-35 w-58 flex-col gap-3 rounded-[20px] border bg-setup-tile p-4 dark:border-white/8"
            key={perk.title}
          >
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-[11px] [&_svg]:size-5",
                perk.tint,
              )}
            >
              {perk.icon}
            </span>
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium text-foreground">
                {perk.title}
              </p>
              <p className="text-xs text-muted-foreground">{perk.line}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-8">
        <ConnectButton
          className="h-10 px-5 text-base"
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
