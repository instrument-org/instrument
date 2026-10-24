import { useChatNote } from "@/client/components/billing/chat-note";
import { PlanNeeded } from "@/client/components/model-picker";
import { AccountSection } from "@/client/components/settings/account-section";
import { SetupFooter } from "@/client/components/setup/kit/setup-page";
import { FreeAccountPage } from "@/client/components/setup/steps/free-account";
import { ChooseAI } from "@/client/components/setup/steps/choose-ai";
import { AddProviderSheet } from "@/client/components/studio-modals/add-provider-sheet";
import { Button } from "@/client/components/ui/button";
import { rpcClient } from "@/client/rpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { z } from "zod";

import { getDebugRoute } from "./-debug-routes";
import {
  CLAUDE_ACCOUNT_MODEL,
  OUR_MODEL,
  platformFailure,
} from "./-transcript/parts";
import { buildFrames } from "./-transcript/frames";
import { fail, prose, user } from "./-transcript/script";
import { imageRefused, imageUnavailable } from "./-transcript/tools";
import {
  getTrialMode,
  type TrialModeId,
  trialModeOffer,
  trialModes,
  trialModeStatus,
} from "./-trial-modes";

const noop = () => {};

/**
 * Every surface whose words or buttons follow how the trial starts, each
 * drawn by its real component. `signedIn` is the account the surface is for:
 * the setup outcome page and Add a provider offer the trial only signed out.
 */
const surfaces = [
  {
    id: "setup-outcome",
    label: "Setup: sign-in outcome",
    render: () => (
      <div className="flex h-170 w-240 flex-col">
        <ChooseAI
          hold={noop}
          initial={{
            kind: "outcome",
            outcome: { kind: "no-plan" },
            provider: "chatgpt",
          }}
          onDone={noop}
        />
      </div>
    ),
    signedIn: false,
  },
  {
    id: "settings-plan",
    label: "Settings: plan",
    render: () => (
      <div className="w-170 p-4">
        <AccountSection />
      </div>
    ),
    signedIn: true,
  },
  {
    id: "model-picker",
    label: "Model picker",
    render: () => (
      <div className="w-100 rounded-xl border border-border bg-popover pt-2">
        <PlanNeeded />
      </div>
    ),
    signedIn: true,
  },
  {
    id: "chat-note",
    label: "Chat note",
    render: (mode: TrialModeId) => (
      <ChatNoteSample mode={mode} refused={false} />
    ),
    signedIn: true,
  },
  {
    id: "chat-note-refused",
    label: "Chat note after a refused turn",
    render: (mode: TrialModeId) => <ChatNoteSample mode={mode} refused />,
    signedIn: true,
  },
  {
    id: "chat-note-image",
    label: "Chat note after a refused image",
    render: () => <ImageNoteSample />,
    signedIn: true,
  },
  {
    id: "chat-note-image-signed-out",
    label: "Chat note for an image, signed out",
    render: () => <ImageNoteSample signedOut />,
    signedIn: false,
  },
  {
    id: "add-provider",
    label: "Add a provider",
    render: () => (
      <div className="w-140 rounded-2xl border border-border bg-background">
        <AddProviderSheet
          onComplete={noop}
          onDone={noop}
          onInstrumentSignedIn={noop}
        />
      </div>
    ),
    signedIn: false,
  },
  {
    id: "log-in-free-account",
    label: "Log in: free account",
    render: () => (
      <div className="flex w-190 flex-col rounded-2xl border border-border bg-background">
        <FreeAccountPage
          calledOut="Dictation"
          fit="dialog"
          footer={
            <SetupFooter
              next="none"
              skip={{ label: "Not now", onClick: noop }}
            />
          }
          onSignedIn={noop}
        />
      </div>
    ),
    signedIn: false,
  },
] as const satisfies readonly {
  id: string;
  label: string;
  render: (mode: TrialModeId) => ReactNode;
  signedIn: boolean;
}[];

const searchSchema = z.object({
  mode: z.string().optional(),
  surface: z.string().optional(),
});

export const Route = createFileRoute("/debug/trial-modes")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getDebugRoute("trial-modes").title }],
  }),
  validateSearch: searchSchema,
});

/**
 * A looking tool: each trial surface under each way the platform can offer
 * the trial, from fixture answers to `billing.offer` and `billing.status`
 * seeded into a QueryClient of the surface's own, so nothing here reads or
 * changes the real account. Its buttons still reach the real RPC, so it is
 * for looking, not clicking.
 */
function RouteComponent() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const surface =
    surfaces.find((item) => item.id === search.surface) ?? surfaces[0];
  const surfaceId = surface.id;
  const modeId = (
    trialModes.find((item) => item.id === search.mode) ?? trialModes[0]
  ).id;

  return (
    <div className="flex size-full flex-col overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <div className="flex flex-wrap gap-1">
          {surfaces.map((item) => (
            <Button
              key={item.id}
              onClick={() => {
                void navigate({ search: { mode: modeId, surface: item.id } });
              }}
              size="sm"
              variant={item.id === surfaceId ? "default" : "ghost"}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {trialModes.map((mode) => (
            <Button
              key={mode.id}
              onClick={() => {
                void navigate({
                  search: { mode: mode.id, surface: surfaceId },
                });
              }}
              size="sm"
              variant={mode.id === modeId ? "default" : "ghost"}
            >
              {mode.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-6">
        <div
          className="inline-block bg-background"
          data-trial-mode={modeId}
          data-trial-surface={surfaceId}
        >
          <FixtureQueries
            key={`${surfaceId}:${modeId}`}
            mode={modeId}
            signedIn={surface.signedIn}
          >
            {surface.render(modeId)}
          </FixtureQueries>
        </div>
      </div>
    </div>
  );
}

/**
 * A QueryClient holding the mode's offer, the account's status and whether
 * it is signed in, stamped far in the future so no surface reads them again.
 * Anything else a surface asks for goes to the real RPC.
 */
function FixtureQueries({
  children,
  mode,
  signedIn,
}: {
  children: ReactNode;
  mode: TrialModeId;
  signedIn: boolean;
}) {
  const [client] = useState(() => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          refetchOnMount: false,
          refetchOnReconnect: false,
          refetchOnWindowFocus: false,
          retry: 0,
        },
      },
    });
    const updatedAt = Date.now() + 365 * 86_400_000;
    queryClient.setQueryData(
      rpcClient.auth.live.hasToken.experimental_liveOptions().queryKey,
      signedIn,
      { updatedAt },
    );
    queryClient.setQueryData(
      rpcClient.billing.offer.queryOptions().queryKey,
      trialModeOffer(mode, signedIn),
      { updatedAt },
    );
    if (signedIn) {
      queryClient.setQueryData(
        rpcClient.billing.status.queryOptions().queryKey,
        trialModeStatus(mode),
        { updatedAt },
      );
    }
    return queryClient;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * The note over a chat's reply box on Instrument's models: before any turn
 * is refused, as the status reads, or after one the platform refused with
 * the mode's reason, which is where a card trial's line shows.
 */
function ChatNoteSample({
  mode,
  refused,
}: {
  mode: TrialModeId;
  refused: boolean;
}) {
  const [messages] = useState(() =>
    refused
      ? (buildFrames(
          [
            user("Can you help me plan my week?"),
            fail(
              platformFailure({
                classification: "usage-limit",
                code: "subscription-required",
                details: {
                  reason: getTrialMode(mode).reason,
                },
                message: "Choose a plan to keep going.",
                name: "AI_APICallError",
                statusCode: 402,
              }),
              OUR_MODEL,
            ),
          ],
          Date.now() - 60_000,
        ).at(-1)?.messages ?? [])
      : [],
  );
  const note = useChatNote({
    isAgentRunning: false,
    messages,
    modelURI: OUR_MODEL.uri,
  });
  return (
    <div className="w-160 p-3">
      {note?.render({ nudge: 0, openModelPicker: noop }) ?? (
        <p className="text-sm text-muted-foreground">No note.</p>
      )}
    </div>
  );
}

/**
 * The note over a Claude chat's reply box after its image ran into the free
 * account: spent for now, which offers the mode's trial, or nothing to make
 * images with while signed out.
 */
function ImageNoteSample({ signedOut = false }: { signedOut?: boolean }) {
  const [messages] = useState(
    () =>
      buildFrames(
        [
          user("Make a header image for our pricing page."),
          signedOut
            ? imageUnavailable({
                filePath: "./pricing-header",
                prompt: "A help desk team, flat illustration",
              })
            : imageRefused({
                filePath: "./pricing-header",
                prompt: "A help desk team, flat illustration",
                refusal: {
                  code: "usage-limit-exceeded",
                  resetsAt: new Date(Date.now() + 21 * 3_600_000).toISOString(),
                },
              }),
          prose("I couldn't make the image."),
        ],
        Date.now() - 60_000,
      ).at(-1)?.messages ?? [],
  );
  const note = useChatNote({
    isAgentRunning: false,
    messages,
    modelURI: CLAUDE_ACCOUNT_MODEL.uri,
  });
  return (
    <div className="w-160 p-3">
      {note?.render({ nudge: 0, openModelPicker: noop }) ?? (
        <p className="text-sm text-muted-foreground">No note.</p>
      )}
    </div>
  );
}
