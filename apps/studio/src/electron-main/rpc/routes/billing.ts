import { openExternal } from "@/electron-main/lib/open-external";
import {
  lastPlatformRefusal,
  recordPlatformRefusal,
} from "@/electron-main/lib/platform-refusals";
import { setDefaultModel } from "@/electron-main/lib/set-default-model";
import { platformApiRpcClient } from "@/electron-main/platform-api/client";
import { getToken } from "@/electron-main/platform-api/utils";
import { authenticated, base, devOnly } from "@/electron-main/rpc/base";
import { getSessionStore } from "@/electron-main/stores/workspace/session";
import { readPlatformRefusal } from "@instrument-org/ai-gateway";
import { ORPCError } from "@orpc/client";
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
  if (!app.isPackaged && process.env.STUDIO_DRIVE_PURPOSE) {
    heldBackPage = url;
    return;
  }
  await openExternal(url);
}

const offer = base.handler(() => platformApiRpcClient.billing.offer.call());

const status = authenticated.handler(() =>
  platformApiRpcClient.billing.status.call(),
);

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
 * Moves a live subscription to another plan through the API, which charges
 * the difference with Stripe's pending updates so the higher limits wait on
 * the payment. When the payment needs the person (a card to confirm), the
 * API hands back a page for it, opened like Checkout.
 *
 * STUB: an API without `billing.changePlan` answers 404, and until every
 * target serves it the Customer Portal stands in. Its own plan switch is to be
 * turned off, so this fallback goes once the API procedure ships everywhere.
 */
const changePlan = authenticated
  .input(z.object({ plan: z.string() }))
  .handler(async ({ input }) => {
    try {
      const result = await platformApiRpcClient.billing.changePlan.call({
        plan: input.plan,
      });
      const url: unknown = Reflect.get(result, "url");
      if (typeof url === "string") {
        await openBillingPage(url);
      }
      return { via: "api" as const };
    } catch (error) {
      if (!(error instanceof ORPCError) || error.status !== 404) {
        throw error;
      }
      const { url } = await platformApiRpcClient.billing.createPortal.call();
      await openBillingPage(url);
      return { via: "portal" as const };
    }
  });

const lastRefusal = base.handler(() => lastPlatformRefusal() ?? null);

const API_BASE_URL = import.meta.env.MAIN_VITE_APP_API_BASE_URL;

/**
 * For the dev-only billing tools: an unpackaged build talking to an API on
 * this machine, so neither can reach a deployed platform.
 */
const localDev = devOnly.use(({ errors, next }) => {
  const host = new URL(API_BASE_URL).hostname;
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
  apiBaseUrl: API_BASE_URL,
  isPackaged: app.isPackaged,
}));

/**
 * Signs in with a bearer token minted by `pnpm billing dev-session` against
 * the local API, the way the Google sign-in stores one.
 */
const setDevToken = localDev
  .input(z.object({ token: z.string().min(1) }))
  .handler(async ({ input }) => {
    getSessionStore().set("apiBearerToken", input.token.trim());
    await setDefaultModel();
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
    const response = await fetch(`${API_BASE_URL}/gateway/openrouter${path}`, {
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
    });
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
  status,
};
