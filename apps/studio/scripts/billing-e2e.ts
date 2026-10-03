/**
 * Billing end to end, driven through a real Studio instance against a local
 * API: a fresh user's trial starts on their first hosted request, runs out
 * into 402 subscription-required, Stripe Checkout (test mode, card 4242)
 * subscribes them to plan_10, the webhook flips their status, the 5h window
 * fills into 429 usage-limit-exceeded with Retry-After, an operator reset
 * reopens it, and the Customer Portal switches them to plan_40 and cancels.
 * Every step is asserted against the API and against what Studio's billing
 * debug page shows, and the page is captured per step.
 *
 *   INSTRUMENT_API_DIR=<internal checkout>/apps/api \
 *   BILLING_BASE_URL=http://localhost:49100 \
 *   node apps/studio/scripts/billing-e2e.ts [--out <dir>] [--no-real-calls]
 *
 * Needs, already running: wrangler dev (`pnpm dev` in the API) at
 * BILLING_BASE_URL, and `pnpm stripe:listen` forwarding to it. Studio is
 * booted here on a user data directory of its own, never the shared dev one,
 * and reused while an instance of this checkout runs with the same purpose.
 * Two real model calls go through Studio's own chat path (a few cents); every
 * other request is answered by the API's stub upstream.
 *
 * Studio gets no operator power: limits change through `pnpm billing`, and
 * the checkout and portal URLs come from the user's own
 * `billing.createCheckout` and `billing.createPortal`, driven in a headless
 * browser so the system one never opens.
 */
import { type Browser, chromium } from "playwright";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, parseEnv, promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);
const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const { values: flags } = parseArgs({
  allowNegative: true,
  options: {
    out: { type: "string" },
    "real-calls": { default: true, type: "boolean" },
  },
});

const API_DIR = process.env.INSTRUMENT_API_DIR;
if (!API_DIR) {
  throw new Error("Set INSTRUMENT_API_DIR to the internal repo's apps/api");
}
const BASE_URL = process.env.BILLING_BASE_URL ?? "http://localhost:49100";
const devVars = parseEnv(readFileSync(path.join(API_DIR, ".dev.vars"), "utf8"));
const STRIPE_KEY = devVars.STRIPE_SECRET_KEY ?? "";
if (!STRIPE_KEY.startsWith("sk_test_")) {
  throw new Error("The API's .dev.vars must hold a test-mode Stripe key");
}
const WEB_BASE_URL = devVars.WEB_BASE_URL ?? "http://localhost:49110";

const RUN = new Date().toISOString().replaceAll(/[:.]/g, "-").slice(0, 19);
const OUT = flags.out ?? path.join(os.tmpdir(), "billing-e2e", RUN);
mkdirSync(OUT, { recursive: true });
const EMAIL = `studio-e2e-${RUN.toLowerCase().replaceAll("-", "")}@finalpoint.co`;
const PURPOSE = "billing e2e";
const STUDIO_DIR = path.resolve(import.meta.dirname, "..");
const DRIVE_DIR = path.resolve(
  STUDIO_DIR,
  "../../.agents/skills/studio-chrome-devtools/scripts",
);

// --- what comes back, parsed ------------------------------------------------

const StatusSchema = z.object({
  canSubscribe: z.boolean(),
  plan: z.string(),
  subscription: z
    .object({
      cancelAtPeriodEnd: z.boolean(),
      currentPeriodEnd: z.string().optional(),
      status: z.string(),
    })
    .optional(),
  trial: z.object({ endsAt: z.string().optional(), state: z.string() }),
  windows: z.array(z.object({ key: z.string(), percentUsed: z.number() })),
});

const RefusalSchema = z.object({
  at: z.number(),
  code: z.string(),
  details: z.looseObject({
    reason: z.string().optional(),
    resetsAt: z.string().optional(),
    window: z.string().optional(),
  }),
  path: z.string(),
  retryAfterSeconds: z.number().optional(),
  status: z.number(),
});

const BurnSchema = z.object({
  bodyHasCost: z.boolean(),
  refusal: RefusalSchema.nullable(),
  status: z.number(),
});

const LedgerSchema = z.array(
  z.looseObject({
    kind: z.string(),
    providerUsd: z.union([z.number(), z.string()]),
    usd: z.number(),
  }),
);

const UserDetailSchema = z.looseObject({
  subscriptions: z.array(z.looseObject({ id: z.string() })),
});

const MessageSchema = z.looseObject({
  metadata: z
    .looseObject({
      error: z
        .looseObject({
          classification: z.string().optional(),
          responseBody: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  role: z.string(),
});

const PageSchema = z.object({
  refusal: z.record(z.string(), z.string()),
  status: z.record(z.string(), z.string()),
  windows: z.record(z.string(), z.array(z.string())),
});

// --- the API, as the user and as an operator --------------------------------

/** `pnpm billing <args> --json` against the target. */
async function billing(...args: string[]): Promise<unknown> {
  const { stdout } = await run("pnpm", ["-s", "billing", ...args, "--json"], {
    cwd: API_DIR,
    env: { ...process.env, BILLING_BASE_URL: BASE_URL },
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

/** One of the user's own oRPC procedures, called the way any client would. */
async function userRpc(
  token: string,
  procedure: string,
  input?: unknown,
): Promise<unknown> {
  const response = await fetch(`${BASE_URL}/rpc/${procedure}`, {
    body: JSON.stringify(input === undefined ? {} : { json: input }),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  const body = z.object({ json: z.unknown() }).parse(await response.json());
  if (!response.ok) {
    throw new Error(`${procedure} ${response.status} ${JSON.stringify(body)}`);
  }
  return body.json;
}

/** Ends a subscription in Stripe with the test key. */
async function endSubscription(id: string) {
  const response = await fetch(
    `https://api.stripe.com/v1/subscriptions/${id}`,
    {
      headers: { authorization: `Bearer ${STRIPE_KEY}` },
      method: "DELETE",
    },
  );
  if (!response.ok) {
    throw new Error(`Stripe refused to end ${id}: ${response.status}`);
  }
}

// --- steps ------------------------------------------------------------------

const steps: { detail: string; ms: number; name: string; ok: boolean }[] = [];
let shotIndex = 0;

async function step(name: string, body: () => Promise<string | undefined>) {
  const startedAt = Date.now();
  try {
    const detail = (await body()) ?? "";
    steps.push({ detail, ms: Date.now() - startedAt, name, ok: true });
    process.stdout.write(`PASS  ${name}${detail ? `  (${detail})` : ""}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    steps.push({
      detail: message,
      ms: Date.now() - startedAt,
      name,
      ok: false,
    });
    process.stdout.write(`FAIL  ${name}  (${message})\n`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/** Retries `check` until it stops throwing: settles and webhooks land late. */
async function eventually<T>(
  check: () => Promise<T>,
  { every = 500, timeout = 30_000 } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > deadline) {
        throw error;
      }
      await sleep(every);
    }
  }
}

// --- Studio -----------------------------------------------------------------

/** The part of studio-drive's `app` this script uses. */
interface StudioApp {
  click: (target: { text: string }) => Promise<unknown>;
  close: () => void;
  eval: (expression: string) => Promise<unknown>;
  expect: (condition: string, message: string) => Promise<unknown>;
  goto: (route: string) => Promise<unknown>;
  rpc: (route: string, input: unknown) => Promise<unknown>;
  shot: (file: string) => Promise<unknown>;
  waitFor: (
    condition: string,
    options?: { timeout?: number },
  ) => Promise<unknown>;
  waitForIdle: (options: {
    taskId: string;
    timeout: number;
  }) => Promise<unknown>;
}

function isStudioApp(value: unknown): value is StudioApp {
  return (
    typeof value === "object" &&
    value !== null &&
    ["click", "eval", "goto", "rpc", "shot", "waitFor", "waitForIdle"].every(
      (key) => typeof Reflect.get(value, key) === "function",
    )
  );
}

async function bootStudio(): Promise<StudioApp> {
  const userData = path.join(os.tmpdir(), "billing-e2e-studio-user-data");
  mkdirSync(userData, { recursive: true });
  await run(
    "node",
    [path.join(DRIVE_DIR, "studio-drive.mjs"), "boot", "--purpose", PURPOSE],
    {
      cwd: STUDIO_DIR,
      env: {
        ...process.env,
        // Its own preferences, workspace, and session: never the shared dev
        // user data a person's instance runs on.
        ELECTRON_USER_DATA_DIR: userData,
        MAIN_VITE_APP_API_BASE_URL: BASE_URL,
        SKIP_ONBOARDING: "true",
      },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 10 * 60_000,
    },
  );
  // An untyped module from the skill, checked at the boundary instead.
  const studioAppModule: unknown = await import(
    path.join(DRIVE_DIR, "studio-app.mjs")
  );
  const connect: unknown = Reflect.get(Object(studioAppModule), "connect");
  assert(typeof connect === "function", "studio-app.mjs has no connect");
  const app: unknown = await Promise.resolve(
    Reflect.apply(connect, undefined, [{ allowReload: true }]),
  );
  assert(isStudioApp(app), "studio-app.mjs returned an unexpected app");
  const environment = z
    .object({ userData: z.string().optional() })
    .parse(await app.rpc("debug.getAppEnvironment", {}));
  assert(
    environment.userData,
    "Studio is running on the shared dev user data; stop it and let this script boot its own",
  );
  const { apiBaseUrl } = z
    .object({ apiBaseUrl: z.string() })
    .parse(await app.rpc("billing.dev.environment", {}));
  assert(
    apiBaseUrl === BASE_URL,
    `Studio talks to ${apiBaseUrl}, not ${BASE_URL}; stop it (studio-drive stop) and run again`,
  );
  return app;
}

/** RPC errors come back as data through the debug bridge; this throws them. */
async function studioRpc(app: StudioApp, route: string, input?: unknown) {
  const result = await app.rpc(route, input ?? {});
  const failed = z.object({ error: z.unknown() }).safeParse(result);
  if (failed.success && failed.data.error) {
    throw new Error(
      `${route}: ${JSON.stringify(failed.data.error).slice(0, 300)}`,
    );
  }
  return result;
}

/** What the debug page shows, field by field. */
async function pageFields(app: StudioApp) {
  return PageSchema.parse(
    await app.eval(`(() => {
      const read = (section) => Object.fromEntries(
        [...document.querySelectorAll('[data-billing-section="' + section + '"] [data-billing-field]')]
          .map((node) => [node.dataset.billingField, node.textContent]));
      const windows = Object.fromEntries(
        [...document.querySelectorAll('[data-billing-section="billing.status"] [data-billing-row]')]
          .map((row) => [row.dataset.billingRow, [...row.children].map((cell) => cell.textContent)]));
      return { refusal: read("Last refusal"), status: read("billing.status"), windows };
    })()`),
  );
}

function nextShot(slug: string) {
  shotIndex += 1;
  return path.join(OUT, `${String(shotIndex).padStart(2, "0")}-${slug}.png`);
}

/** The billing debug page, refreshed, captured, and read back. */
async function capturePage(app: StudioApp, slug: string) {
  await app.goto("/debug/billing");
  await app.waitFor('document.querySelector("[data-billing-section]")');
  // The actions sit below the fold; the click helper needs them on screen.
  await app.eval(
    'document.querySelector("[data-billing-section=Actions]").scrollIntoView({ block: "center" })',
  );
  await app.click({ text: "Refresh" });
  await sleep(1500);
  await app.eval(
    'document.querySelector("[data-billing-section]").scrollIntoView()',
  );
  await app.shot(nextShot(slug));
  return pageFields(app);
}

/**
 * One chat turn through Studio's real request path: the workspace's agent,
 * the ai-gateway proxy, and the platform gateway.
 */
async function chatTurn(app: StudioApp, modelURI: string, prompt: string) {
  const { id, sessionId } = z
    .object({ id: z.string(), sessionId: z.string() })
    .parse(
      await studioRpc(app, "workspace.task.create", {
        modelURI,
        name: `billing e2e ${shotIndex}`,
        prompt,
      }),
    );
  await app.waitForIdle({ taskId: id, timeout: 180_000 });
  const listed = await studioRpc(app, "workspace.message.list", {
    id,
    sessionId,
  });
  const list = z
    .union([
      z.array(MessageSchema),
      z
        .object({ messages: z.array(MessageSchema) })
        .transform((v) => v.messages),
    ])
    .parse(listed);
  return { assistant: list.filter((m) => m.role === "assistant"), id, list };
}

/** Whether anything named like a cost field reached Studio's store. */
function carriesCost(value: unknown) {
  return /"(?:cost|cost_details|is_byok|upstream_inference_cost)"\s*:/.test(
    JSON.stringify(value),
  );
}

// --- Stripe's hosted pages, headless ----------------------------------------

async function onPage(
  browser: Browser,
  url: string,
  name: string,
  body: (page: Awaited<ReturnType<Browser["newPage"]>>) => Promise<void>,
) {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    await body(page);
    await page.screenshot({
      fullPage: true,
      path: path.join(OUT, `${name}.png`),
    });
  } catch (error) {
    await page.screenshot({
      fullPage: true,
      path: path.join(OUT, `${name}-failure.png`),
    });
    throw error;
  } finally {
    await page.close();
  }
}

function payWithTestCard(browser: Browser, url: string) {
  return onPage(browser, url, "checkout", async (page) => {
    // The card row's own button is covered by its accordion, so the click is
    // dispatched to it directly.
    await page
      .locator("[data-testid=card-accordion-item-button]")
      .dispatchEvent("click");
    await page.locator("#cardNumber").fill("4242424242424242");
    await page.locator("#cardExpiry").fill("12 / 34");
    await page.locator("#cardCvc").fill("123");
    await page.locator("#billingName").fill("Billing E2E");
    await page.locator("#billingCountry").selectOption("US");
    const postal = page.locator("#billingPostalCode");
    if (await postal.isVisible()) {
      await postal.fill("94103");
    }
    // Link would ask for a phone number to save the card.
    const link = page.locator("#enableStripePass");
    if (await link.isChecked().catch(() => false)) {
      await link.uncheck({ force: true });
    }
    const succeeded = page.waitForRequest(
      (request) => request.url().startsWith(`${WEB_BASE_URL}/account`),
      { timeout: 60_000 },
    );
    await page.locator("button[type=submit]").click();
    await succeeded;
  });
}

function portalSwitchPlan(browser: Browser, url: string, planName: string) {
  return onPage(browser, url, "portal-switch", async (page) => {
    await page
      .getByRole("link", { name: /update subscription|update plan/i })
      .or(
        page.getByRole("button", { name: /update subscription|update plan/i }),
      )
      .first()
      .click();
    // The current plan's button reads "Selected"; the other one "Select".
    await page
      .locator("div", { hasText: planName })
      .filter({
        has: page.getByRole("button", { exact: true, name: "Select" }),
      })
      .last()
      .getByRole("button", { exact: true, name: "Select" })
      .click();
    await page
      .getByRole("button", { name: /continue/i })
      .first()
      .click();
    await page
      .getByRole("button", { name: /confirm/i })
      .first()
      .click();
    // Done once the portal leaves the update flow.
    await page.waitForURL((address) => !address.pathname.includes("/update"), {
      timeout: 60_000,
    });
  });
}

function portalCancel(browser: Browser, url: string) {
  return onPage(browser, url, "portal-cancel", async (page) => {
    await page
      .getByRole("link", { name: /cancel/i })
      .or(page.getByRole("button", { name: /cancel/i }))
      .first()
      .click();
    await page
      .getByRole("button", { name: /cancel subscription|cancel plan/i })
      .last()
      .click();
    // Done once the portal leaves the cancel flow.
    await page.waitForURL((address) => !address.pathname.includes("/cancel"), {
      timeout: 60_000,
    });
  });
}

// --- the scenario -------------------------------------------------------------

async function main() {
  const app = await bootStudio();
  const browser = await chromium.launch();
  let token = "";
  let userId = "";
  let modelURI = "";

  const burn = async (usd: number) =>
    BurnSchema.parse(await studioRpc(app, "billing.dev.burn", { usd }));
  const status = async () =>
    StatusSchema.parse(await studioRpc(app, "billing.status"));
  /** Burns `usd` per request until the platform refuses, returning the refusal. */
  const burnUntilRefused = async (usd: number, code: string) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await burn(usd);
      assert(!result.bodyHasCost, "a burn response carried a cost field");
      if (result.refusal) {
        assert(
          result.refusal.code === code,
          `refused with ${result.refusal.code}, expected ${code}`,
        );
        return result.refusal;
      }
      assert(result.status === 200, `burn answered ${result.status}`);
      // Settlement lands after the response.
      await sleep(400);
    }
    throw new Error(`never refused with ${code}`);
  };
  const ledger = async (limit: number) =>
    LedgerSchema.parse(
      await billing("user", "ledger", userId, "--limit", String(limit)),
    );
  /** A real turn that the platform refuses: one error, classified, carded. */
  const refusedTurn = async (cardText: string, slug: string) => {
    const turn = await chatTurn(
      app,
      modelURI,
      "Reply with the single word: ok",
    );
    const errors = turn.assistant.flatMap((m) =>
      m.metadata?.error ? [m.metadata.error] : [],
    );
    assert(errors.length === 1, `${errors.length} error messages (retried?)`);
    const [error] = errors;
    assert(
      error?.classification === "usage-limit",
      `classified ${String(error?.classification)}`,
    );
    await app.goto(`/tasks/${turn.id}`);
    await app.waitFor(
      `document.body.innerText.includes(${JSON.stringify(cardText)})`,
      {
        timeout: 20_000,
      },
    );
    await app.shot(nextShot(slug));
    return error;
  };

  await step("dev-session mints a fresh user's token", async () => {
    const session = z
      .object({ created: z.boolean(), token: z.string(), userId: z.string() })
      .parse(await billing("dev-session", "--email", EMAIL));
    token = session.token;
    userId = session.userId;
    assert(session.created, "the user already existed");
    return `${EMAIL} (${userId})`;
  });
  if (!token) {
    return finish(app, browser);
  }

  await step(
    "Studio signs in with it and shows an available trial",
    async () => {
      await studioRpc(app, "billing.dev.setDevToken", { token });
      const current = await status();
      assert(
        current.plan === "trial" && current.trial.state === "available",
        JSON.stringify(current),
      );
      const page = await capturePage(app, "trial-available");
      assert(
        page.status.plan === "trial",
        `page plan ${String(page.status.plan)}`,
      );
      assert(
        page.status["trial.state"] === "available",
        `page trial ${String(page.status["trial.state"])}`,
      );
      const { models } = z
        .object({
          models: z.array(
            z.looseObject({ providerId: z.string(), uri: z.string() }),
          ),
        })
        .parse(await studioRpc(app, "gateway.models.list"));
      modelURI =
        models.find((model) => model.providerId === "instrument/auto")?.uri ??
        "";
      assert(modelURI, "Auto is not in Studio's model list");
      return modelURI;
    },
  );

  await step("first hosted request starts the trial", async () => {
    if (flags["real-calls"]) {
      // A real model call through Studio's chat path, settled from the
      // upstream's inline cost.
      const turn = await chatTurn(
        app,
        modelURI,
        "Reply with the single word: ok",
      );
      assert(
        !turn.assistant.some((m) => m.metadata?.error),
        JSON.stringify(turn.assistant.map((m) => m.metadata?.error)),
      );
      assert(!carriesCost(turn.list), "a stored message carries a cost field");
    } else {
      const result = await burn(0.05);
      assert(result.status === 200, `burn answered ${result.status}`);
    }
    const current = await eventually(async () => {
      const api = StatusSchema.parse(await userRpc(token, "billing/status"));
      assert(api.trial.state === "active", JSON.stringify(api.trial));
      return api;
    });
    const page = await capturePage(app, "trial-active");
    assert(
      page.status["trial.state"] === "active",
      `page trial ${String(page.status["trial.state"])}`,
    );
    const settle = (await ledger(10)).find((row) => row.kind === "settle");
    assert(settle, "no settle in the ledger");
    return `trial ends ${String(current.trial.endsAt)}; settled $${settle.usd} (provider $${settle.providerUsd})`;
  });

  await step(
    "spending the trial's $1 refuses with 402 subscription-required",
    async () => {
      const refusal = await burnUntilRefused(0.4, "subscription-required");
      assert(refusal.status === 402, `status ${refusal.status}`);
      const page = await capturePage(app, "trial-spent-402");
      assert(
        page.refusal.code === "subscription-required",
        `page refusal ${String(page.refusal.code)}`,
      );
      assert(
        page.refusal.status === "402",
        `page status ${String(page.refusal.status)}`,
      );
      return `reason ${String(refusal.details.reason)}`;
    },
  );

  await step(
    "a chat turn after it stops at one error card naming the plan",
    async () => {
      if (!flags["real-calls"]) {
        return "skipped (--no-real-calls)";
      }
      const error = await refusedTurn("Free trial ended", "chat-402-card");
      assert(
        error.responseBody?.includes("subscription-required"),
        "body lacks the code",
      );
      const refusal = RefusalSchema.nullable().parse(
        await studioRpc(app, "billing.lastRefusal"),
      );
      assert(
        refusal?.code === "subscription-required",
        `last refusal ${JSON.stringify(refusal)}`,
      );
      return `classified ${String(error.classification)}, card shown, gateway hook saw ${refusal.path}`;
    },
  );

  await step(
    "Stripe Checkout with 4242 subscribes to plan_10 by webhook",
    async () => {
      const { url } = z
        .object({ url: z.string() })
        .parse(
          await userRpc(token, "billing/createCheckout", { plan: "plan_10" }),
        );
      assert(url.startsWith("https://checkout.stripe.com"), url);
      await payWithTestCard(browser, url);
      const current = await eventually(
        async () => {
          const next = await status();
          assert(next.plan === "plan_10", `plan ${next.plan}`);
          return next;
        },
        { every: 1000, timeout: 60_000 },
      );
      const api = StatusSchema.parse(await userRpc(token, "billing/status"));
      assert(api.plan === "plan_10", `API plan ${api.plan}`);
      const page = await capturePage(app, "plan-10");
      assert(
        page.status.plan === "plan_10",
        `page plan ${String(page.status.plan)}`,
      );
      assert(
        page.status["subscription.status"] === "active",
        `page subscription ${String(page.status["subscription.status"])}`,
      );
      return `subscription ${String(current.subscription?.status)}, windows ${current.windows.map((w) => w.key).join(",")}`;
    },
  );

  await step(
    "a real call on plan_10 settles and carries no cost to Studio",
    async () => {
      if (!flags["real-calls"]) {
        return "skipped (--no-real-calls)";
      }
      const turn = await chatTurn(
        app,
        modelURI,
        "Reply with the single word: ok",
      );
      assert(!turn.assistant.some((m) => m.metadata?.error), "the turn failed");
      assert(!carriesCost(turn.list), "a stored message carries a cost field");
      const [newest] = await eventually(async () => {
        const rows = await ledger(5);
        assert(
          rows[0]?.kind === "settle",
          `newest ledger row ${String(rows[0]?.kind)}`,
        );
        return rows;
      });
      return `settled $${String(newest?.usd)}`;
    },
  );

  await step(
    "filling the 5h window refuses with 429 usage-limit-exceeded and Retry-After",
    async () => {
      await burn(3.5);
      await sleep(500);
      const refusal = await burnUntilRefused(0.5, "usage-limit-exceeded");
      assert(refusal.status === 429, `status ${refusal.status}`);
      assert(
        refusal.details.window === "5h",
        `window ${String(refusal.details.window)}`,
      );
      const retryAfter = refusal.retryAfterSeconds ?? 0;
      assert(retryAfter > 0, "no Retry-After");
      const resetsIn =
        (Date.parse(refusal.details.resetsAt ?? "") - refusal.at) / 1000;
      assert(
        Math.abs(resetsIn - retryAfter) < 5,
        `Retry-After ${retryAfter}s vs resetsAt in ${resetsIn}s`,
      );
      const page = await capturePage(app, "5h-full-429");
      assert(
        page.refusal.code === "usage-limit-exceeded",
        `page refusal ${String(page.refusal.code)}`,
      );
      assert(
        page.refusal.retryAfterSeconds === String(retryAfter),
        `page Retry-After ${String(page.refusal.retryAfterSeconds)}`,
      );
      assert(
        page.windows["5h"]?.[1] === "100%",
        `page 5h ${String(page.windows["5h"]?.join(" "))}`,
      );
      return `Retry-After ${retryAfter}s, resets ${String(refusal.details.resetsAt)}`;
    },
  );

  await step(
    "a chat turn into the full window stops at one usage-limit card",
    async () => {
      if (!flags["real-calls"]) {
        return "skipped (--no-real-calls)";
      }
      await refusedTurn("Usage limit reached", "chat-429-card");
      await app.expect(
        'document.body.innerText.includes("It resets")',
        "the card to say when it resets",
      );
      return "card shows the reset time";
    },
  );

  await step("an operator reset reopens the window", async () => {
    await billing(
      "user",
      "reset-window",
      userId,
      "5h",
      "--reason",
      `studio e2e ${RUN}`,
    );
    const result = await eventually(async () => {
      const current = await burn(0.01);
      assert(current.status === 200, `burn answered ${current.status}`);
      return current;
    });
    const page = await capturePage(app, "5h-reset");
    // A reset reads as unused: only the one cent burned since counts.
    assert(
      Number.parseFloat(page.windows["5h"]?.[1] ?? "100") < 1,
      `page 5h ${String(page.windows["5h"]?.join(" "))}`,
    );
    return `burn answered ${result.status}; page 5h ${String(page.windows["5h"]?.[1])}`;
  });

  await step("the Customer Portal switches the plan to plan_40", async () => {
    const { url } = z
      .object({ url: z.string() })
      .parse(await userRpc(token, "billing/createPortal"));
    const offer = z
      .object({
        plans: z.array(z.looseObject({ key: z.string(), name: z.string() })),
      })
      .parse(await userRpc(token, "billing/offer"));
    const name =
      offer.plans.find((plan) => plan.key === "plan_40")?.name ?? "$40";
    await portalSwitchPlan(browser, url, name);
    await eventually(
      async () => {
        const current = await status();
        assert(current.plan === "plan_40", `plan ${current.plan}`);
      },
      { every: 1000, timeout: 60_000 },
    );
    const page = await capturePage(app, "plan-40");
    assert(
      page.status.plan === "plan_40",
      `page plan ${String(page.status.plan)}`,
    );
    return `switched to ${name}`;
  });

  await step(
    "cancelling in the portal schedules the end of the plan",
    async () => {
      const { url } = z
        .object({ url: z.string() })
        .parse(await userRpc(token, "billing/createPortal"));
      await portalCancel(browser, url);
      await eventually(
        async () => {
          const current = await status();
          assert(
            current.subscription?.cancelAtPeriodEnd === true,
            JSON.stringify(current.subscription),
          );
        },
        { every: 1000, timeout: 60_000 },
      );
      const page = await capturePage(app, "cancel-at-period-end");
      assert(
        page.status["subscription.cancelAtPeriodEnd"] === "true",
        `page ${String(page.status["subscription.cancelAtPeriodEnd"])}`,
      );
      return `ends ${String(page.status["subscription.currentPeriodEnd"])}`;
    },
  );

  await step(
    "ending the subscription leaves no paid plan, and hosted requests refuse",
    async () => {
      const detail = UserDetailSchema.parse(
        await billing("user", "show", userId),
      );
      const id = detail.subscriptions[0]?.id;
      assert(id, "no subscription to end");
      await endSubscription(id);
      await eventually(
        async () => {
          const current = await status();
          // The used-up trial still names the plan until its days run out.
          assert(
            !current.subscription &&
              current.canSubscribe &&
              (current.plan === "none" ||
                (current.plan === "trial" && current.trial.state === "ended")),
            JSON.stringify(current),
          );
        },
        { every: 1000, timeout: 60_000 },
      );
      const refused = await burn(0.01);
      assert(
        refused.refusal?.code === "subscription-required",
        `burn ${refused.status} ${String(refused.refusal?.code)}`,
      );
      const page = await capturePage(app, "canceled");
      assert(
        page.status["subscription.status"] === "-",
        `page subscription ${String(page.status["subscription.status"])}`,
      );
      return `plan ${String(page.status.plan)}, trial ${String(page.status["trial.state"])}, refused ${refused.refusal.code}`;
    },
  );

  return finish(app, browser);
}

async function finish(app: StudioApp, browser: Browser) {
  await browser.close();
  app.close();
  const passed = steps.every((entry) => entry.ok);
  writeFileSync(
    path.join(OUT, "steps.json"),
    `${JSON.stringify({ email: EMAIL, passed, steps }, null, 2)}\n`,
  );
  process.stdout.write(
    `\n${passed ? "All steps passed." : "Some steps failed."} Screenshots and steps.json in ${OUT}\n`,
  );
  process.exitCode = passed ? 0 : 1;
}

await main();
