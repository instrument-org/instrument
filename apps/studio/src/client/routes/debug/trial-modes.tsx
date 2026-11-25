import { useChatNote } from "@/client/components/billing/chat-note";
import { PlanNeeded } from "@/client/components/model-picker";
import { AccountSection } from "@/client/components/settings/account-section";
import { SetupFooter } from "@/client/components/setup/kit/setup-page";
import { FreeAccountPage } from "@/client/components/setup/steps/free-account";
import { ChooseAI } from "@/client/components/setup/steps/choose-ai";
import { AddProviderSheet } from "@/client/components/studio-modals/add-provider-sheet";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import { modelsHeldBack } from "@/client/lib/billing";
import { rpcClient } from "@/client/rpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { z } from "zod";

import { getDebugPage } from "./-debug-routes";
import { DebugPageScroller } from "./-page-scroller";
import { DebugHeaderEnd, DebugState } from "./-shell";
import { trialStates } from "./-states/trial-offers";
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
  trialModeUser,
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
    render: () => (
      <div className="flex h-170 w-200 flex-col">
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
    render: () => (
      <div className="w-170 p-4">
        <AccountSection />
      </div>
    ),
    signedIn: true,
  },
  {
    id: "model-picker",
    render: (mode: TrialModeId) => {
      const step = modelsHeldBack(trialModeStatus(mode), new Date());
      return (
        <div className="w-100 rounded-xl border border-border bg-popover pt-2">
          {step && (
            <PlanNeeded
              models={["Auto", "ChatGPT", "Claude", "Gemini"]}
              step={step}
            />
          )}
        </div>
      );
    },
    signedIn: true,
  },
  {
    id: "chat-note",
    render: (mode: TrialModeId) => (
      <ChatNoteSample mode={mode} refused={false} />
    ),
    signedIn: true,
  },
  {
    id: "chat-note-refused",
    render: (mode: TrialModeId) => <ChatNoteSample mode={mode} refused />,
    signedIn: true,
  },
  {
    id: "chat-note-image",
    render: (mode: TrialModeId) => <ImageNoteSample mode={mode} />,
    signedIn: true,
  },
  {
    id: "chat-note-image-signed-out",
    render: (mode: TrialModeId) => <ImageNoteSample mode={mode} signedOut />,
    signedIn: false,
  },
  {
    id: "add-provider",
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
  id: (typeof trialStates)[number]["id"];
  render: (mode: TrialModeId) => ReactNode;
  signedIn: boolean;
}[];

const searchSchema = z.object({
  mode: z.string().optional(),
  /** An older address for a surface, which goes to it as `?state=`. */
  surface: z.string().optional(),
});

export const Route = createFileRoute("/debug/trial-modes")({
  beforeLoad: ({ search }) => {
    if (search.surface) {
      throw redirect({
        replace: true,
        search: { mode: search.mode, state: search.surface },
        to: "/debug/trial-modes",
      });
    }
  },
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getDebugPage("trial-modes").label }],
  }),
  validateSearch: searchSchema,
});

/**
 * A looking tool: every trial surface under one of the ways the platform can
 * offer the trial, from fixture answers to `billing.offer` and
 * `billing.status` seeded into a QueryClient of each surface's own, so
 * nothing here reads or changes the real account. Its buttons still reach
 * the real RPC, so it is for looking, not clicking.
 */
function RouteComponent() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const modeId = (
    trialModes.find((item) => item.id === search.mode) ?? trialModes[0]
  ).id;

  return (
    <DebugPageScroller className="size-full overflow-auto bg-muted/40">
      <DebugHeaderEnd>
        <Tabs
          onValueChange={(mode) => {
            void navigate({ search: (previous) => ({ ...previous, mode }) });
          }}
          value={modeId}
        >
          <TabsList>
            {trialModes.map((mode) => (
              <TabsTrigger key={mode.id} value={mode.id}>
                {mode.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </DebugHeaderEnd>
      <div className="flex w-fit min-w-full flex-col items-center gap-12 p-8">
        {surfaces.map((surface) => (
          <DebugState
            className="flex flex-col gap-2.5"
            id={surface.id}
            key={surface.id}
          >
            <p className="flex items-baseline gap-2">
              <span className="text-sm font-medium">
                {trialStates.find((state) => state.id === surface.id)?.label}
              </span>
              <span className="text-xs text-muted-foreground">
                {surface.signedIn ? "Signed in" : "Signed out"}
              </span>
            </p>
            <div
              className="w-fit overflow-hidden rounded-xl bg-background shadow-xs ring-1 ring-foreground/8"
              data-trial-mode={modeId}
              data-trial-surface={surface.id}
            >
              <FixtureQueries
                key={modeId}
                mode={modeId}
                signedIn={surface.signedIn}
              >
                {surface.render(modeId)}
              </FixtureQueries>
            </div>
          </DebugState>
        ))}
      </div>
    </DebugPageScroller>
  );
}

/**
 * A QueryClient holding the mode's offer, whether the account is signed in
 * and, signed in, who it is and its status, stamped far in the future so no
 * surface reads them again. Anything else a surface asks for goes to the
 * real RPC.
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
      // The account card reads who is signed in again each time it mounts,
      // whatever the cache holds, so the fixture answers that read in place
      // of the real one, which has no account to give.
      queryClient.setQueryDefaults(rpcClient.user.live.me.key(), {
        behavior: {
          onFetch: (context) => {
            context.fetchFn = () => trialModeUser;
          },
        },
      });
    }
    return queryClient;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * The note over a chat's reply box on Instrument's models: before any turn
 * is refused, as the status reads, or after one the platform refused with
 * the mode's reason.
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
                  next: getTrialMode(mode).next,
                  outcome: getTrialMode(mode).outcome,
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
function ImageNoteSample({
  mode,
  signedOut = false,
}: {
  mode: TrialModeId;
  signedOut?: boolean;
}) {
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
                  next: getTrialMode(mode).next,
                  outcome: "limit-reached",
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
