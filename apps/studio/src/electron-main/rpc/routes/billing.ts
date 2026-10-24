import { waitOnWebsite } from "@/electron-main/auth/client";
import { getAuthServerPort } from "@/electron-main/auth/state";
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
import { websitePageUrl } from "@/electron-main/platform-api/web-link";
import { getToken } from "@/electron-main/platform-api/utils";
import { authenticated, base, devOnly } from "@/electron-main/rpc/base";
import { setSessionToken } from "@/electron-main/stores/workspace/session";
import { PAYMENT_FAILED_STATUSES } from "@/shared/billing";
import { readPlatformRefusal } from "@instrument-org/ai-gateway";
import { app } from "electron";
import { z } from "zod";

/** The billing page an agent-driven instance last held back; see `openBillingPage`. */
let heldBackPage: null | string = null;

/**
 * Opens a page of the website's billing in the system browser. A dev
 * instance an agent drives (`studio-drive boot` sets STUDIO_DRIVE_PURPOSE)
 * keeps it instead, for the run to complete in a headless browser, so a run
 * never opens one on the machine it shares with a person.
 */
async function openBillingPage(url: string) {
  // An agent's instance keeps billing out of the person's browser; one booted
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

/** The website's pages for choosing a plan and for the account's own. */
const WEBSITE_PAGES = { account: "/account", plans: "/welcome" } as const;

/**
 * Opens a page of the website in the system browser, signed in as this
 * account when there is one: `plans` to choose a plan or start a trial
 * (`plan` leading), `account` to change or resume the plan and reach
 * Stripe's billing portal. Both offer a way back through the loopback's
 * `/open`. With `wait`, waits on the website the way a sign-in it took over
 * does, for `auth.finishOnWeb` to say when a plan lands.
 */
const openWebsite = base
  .input(
    z.object({
      page: z.enum(["account", "plans"]),
      plan: z.string().optional(),
      wait: z.boolean().optional(),
    }),
  )
  .handler(async ({ input }) => {
    const query = new URLSearchParams();
    const port = getAuthServerPort();
    if (port !== null) {
      query.set("port", String(port));
    }
    if (input.plan) {
      query.set("plan", input.plan);
    }
    const search = query.size > 0 ? `?${query.toString()}` : "";
    const url = await websitePageUrl(`${WEBSITE_PAGES[input.page]}${search}`);
    if (input.wait) {
      waitOnWebsite();
    }
    await openBillingPage(url);
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

/** The billing page an agent-driven instance held back instead of opening. */
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
  dev: { burn, environment, heldBackBillingPage, setDevToken },
  lastRefusal,
  offer,
  openWebsite,
  status,
};
