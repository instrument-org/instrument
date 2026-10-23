import {
  recordHostedFeatures,
  setHostedFeaturesReader,
} from "@/electron-main/lib/hosted-features";
import { fetchNotices } from "@/electron-main/lib/notices";
import { openExternal } from "@/electron-main/lib/open-external";
import {
  lastPlatformRefusal,
  recordPlatformRefusal,
} from "@/electron-main/lib/platform-refusals";
import { setDefaultModel } from "@/electron-main/lib/set-default-model";
import {
  platformApiBaseUrl,
  platformApiOrigin,
} from "@/electron-main/platform-api/base-url";
import { platformApiRpcClient } from "@/electron-main/platform-api/client";
import { getToken } from "@/electron-main/platform-api/utils";
import { authenticated, base, devOnly } from "@/electron-main/rpc/base";
import { setSessionToken } from "@/electron-main/stores/workspace/session";
import { PAYMENT_FAILED_STATUSES } from "@/shared/billing";
import { readPlatformRefusal } from "@instrument-org/ai-gateway";
import { app } from "electron";
import { z } from "zod";

/** The Stripe page an agent-driven instance last held back; see `openBillingPage`. */
let heldBackPage: null | string = null;

/**
 * Opens a Stripe page (Checkout, the portal) in the system browser. A dev
 * instance an agent drives (`studio-drive boot` sets STUDIO_DRIVE_PURPOSE)
 * keeps it instead, for the run to complete in a headless browser, so a run
 * never opens one on the machine it shares with a person.
 */
async function openBillingPage(url: string) {
  // An agent's instance keeps Stripe out of the person's browser; one booted
  // to be seen (`--visible`) has a person driving it, who means to pay.
  if (
    !app.isPackaged &&
    process.env.STUDIO_DRIVE_PURPOSE &&
    process.env.STUDIO_DRIVE_VISIBLE !== "1"
  ) {
    heldBackPage = url;
    return;
  }
  await openExternal(url);
}

const offer = base.handler(() => platformApiRpcClient.billing.offer.call());

/** The last status read's account trouble, to notice the read that brings it on. */
let lastTrouble: string | undefined;

/**
 * What the account's plan, trial and usage stand at. A read that finds a
 * payment failed or a trial over, where the last one didn't, asks for the
 * bell's notices at once: the service sends the account notice for it, and
 * otherwise the bell would only hear at its next poll, hours away.
 */
async function readStatus() {
  const read = await platformApiRpcClient.billing.status.call();
  recordHostedFeatures(read.features);
  const trouble = PAYMENT_FAILED_STATUSES.has(read.subscription?.status ?? "")
    ? "payment-failed"
    : !read.subscription && read.trial.state === "ended"
      ? "trial-ended"
      : undefined;
  if (trouble && trouble !== lastTrouble) {
    void fetchNotices();
  }
  lastTrouble = trouble;
  return read;
}

setHostedFeaturesReader(readStatus);

const status = authenticated.handler(readStatus);

/** Stripe's hosted Checkout for one plan, in the system browser. */
const openCheckout = authenticated
  .input(z.object({ plan: z.string() }))
  .handler(async ({ input }) => {
    const { url } = await platformApiRpcClient.billing.createCheckout.call({
      plan: input.plan,
    });
    await openBillingPage(url);
    return { url };
  });

/** Stripe's Customer Portal, where every plan change and cancellation happens. */
const openPortal = authenticated.handler(async () => {
  const { url } = await platformApiRpcClient.billing.createPortal.call();
  await openBillingPage(url);
  return { url };
});

/**
 * Moves a live subscription to another plan through the API. An upgrade
 * charges the difference with Stripe's pending updates so the higher limits
 * wait on the payment; when that payment needs the person (a card to
 * confirm), the API hands back the invoice's page, opened like Checkout. A
 * downgrade is scheduled for the end of the period, and choosing the current
 * plan again drops it.
 */
const changePlan = authenticated
  .input(z.object({ plan: z.string() }))
  .handler(async ({ input }) => {
    const result = await platformApiRpcClient.billing.changePlan.call({
      plan: input.plan,
    });
    if (result.status === "pending" && result.invoiceUrl) {
      await openBillingPage(result.invoiceUrl);
    }
    return result;
  });

/**
 * Starts the free trial, the only way it starts, when the person picks it
 * (setup, the plan sheet, a refused chat); answers the billing status
 * with the trial's end date. With `offer: "beta"`, claims the beta offer's
 * free months as the trial.
 */
const startTrial = authenticated
  .input(z.object({ offer: z.literal("beta").optional() }).optional())
  .handler(async ({ input }) => {
    const started = await platformApiRpcClient.billing.startTrial.call(input);
    recordHostedFeatures(started.features);
    return started;
  });

const lastRefusal = base.handler(() => lastPlatformRefusal() ?? null);

/**
 * For the dev-only billing tools: an unpackaged build talking to an API on
 * this machine, so neither can reach a deployed platform.
 */
const localDev = devOnly.use(({ errors, next }) => {
  const host = new URL(platformApiBaseUrl()).hostname;
  if (app.isPackaged || (host !== "localhost" && host !== "127.0.0.1")) {
    throw errors.UNAUTHORIZED({
      message: "Only a dev build pointed at a local API",
    });
  }
  return next();
});

/** The Stripe page an agent-driven instance held back instead of opening. */
const heldBackBillingPage = localDev.handler(() => ({ url: heldBackPage }));

/** Where this build sends platform requests, for the debug page to show. */
const environment = devOnly.handler(() => ({
  apiBaseUrl: platformApiBaseUrl(),
  isPackaged: app.isPackaged,
}));

/**
 * Signs in with a bearer token minted by `pnpm billing dev-session` against
 * the local API, the way the Google sign-in stores one.
 */
const setDevToken = localDev
  .input(z.object({ token: z.string().min(1) }))
  .handler(async ({ input }) => {
    setSessionToken(platformApiOrigin(), input.token.trim());
    await setDefaultModel({ replacing: "anything" });
  });

/**
 * Spends `usd` in one hosted request answered by the local API's stub
 * upstream (`x-stub-upstream`), which a local API lets a client price. Any
 * refusal is recorded like a chat turn's.
 */
const burn = localDev
  .input(z.object({ usd: z.number().nonnegative() }))
  .handler(async ({ errors, input }) => {
    const token = getToken();
    if (!token) {
      throw errors.UNAUTHORIZED();
    }
    const path = "/v1/chat/completions";
    const response = await fetch(
      `${platformApiBaseUrl()}/gateway/openrouter${path}`,
      {
        body: JSON.stringify({
          messages: [{ content: "burn", role: "user" }],
          model: "instrument/auto",
          stream: true,
        }),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-stub-cost": String(input.usd),
          "x-stub-upstream": "1",
        },
        method: "POST",
      },
    );
    const refusal = response.ok
      ? undefined
      : await readPlatformRefusal(response.clone(), path);
    if (refusal) {
      recordPlatformRefusal(refusal);
    }
    // Read whole so the request settles before the caller reads status, and
    // so the page can say whether a cost field ever reached the client.
    const body = await response.text();
    return {
      bodyHasCost: /"(?:cost|cost_details|is_byok)"\s*:/.test(body),
      refusal: refusal ?? null,
      status: response.status,
    };
  });

export const billing = {
  changePlan,
  dev: { burn, environment, heldBackBillingPage, setDevToken },
  lastRefusal,
  offer,
  openCheckout,
  openPortal,
  startTrial,
  status,
};
