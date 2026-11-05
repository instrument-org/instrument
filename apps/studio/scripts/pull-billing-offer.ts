/**
 * The offer someone signed out gets from the platform API, kept as the copy this
 * app ships (`src/shared/billing-offer-snapshot.json`), which a window shows
 * until the server answers.
 *
 *   pnpm --filter @instrument-org/studio billing-offer:pull
 *
 * Every CI build runs it (`build:vite`, with `--if-ci`), so a build carries what
 * its server says that day. No answer, or an answer this build's contract can't
 * read, fails that build. A local build keeps the repo's copy, which running
 * this by hand refreshes.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { type ContractRouterClient } from "@orpc/contract";

import { APP_DOMAIN } from "../../../packages/shared/src/constants.ts";
import {
  type BillingOffer,
  BillingOfferSchema,
} from "../src/electron-main/platform-api/billing-offer.ts";
// `import type` so Node erases it whole: the contract's module doesn't load here.
import type { contract } from "../src/electron-main/platform-api/contract.ts";
import current from "../src/shared/billing-offer-snapshot.json" with { type: "json" };

const SNAPSHOT_PATH = path.resolve(
  import.meta.dirname,
  "../src/shared/billing-offer-snapshot.json",
);
const ATTEMPTS = 3;

/**
 * The copy to ship for `answer`. The server can offer no trial for a while and
 * then one again, so a build made during that keeps the trial its copy has
 * rather than showing everyone no trial until the server answers. A trial gone
 * for good is a hand edit to the repo's copy.
 */
export function nextSnapshot(
  answer: BillingOffer,
  copy: BillingOffer,
): BillingOffer {
  return answer.trial === null ? { ...answer, trial: copy.trial } : answer;
}

async function askServer(): Promise<BillingOffer> {
  const base =
    process.env.MAIN_VITE_APP_API_BASE_URL || `https://api.${APP_DOMAIN}`;
  const client: ContractRouterClient<typeof contract> = createORPCClient(
    new RPCLink({ url: new URL("/rpc", base) }),
  );
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await client.billing.offer();
    } catch (error) {
      if (attempt === ATTEMPTS) {
        throw new Error(`Couldn't read the offer from ${base}`, {
          cause: error,
        });
      }
      await sleep(attempt * 2000);
    }
  }
}

if (import.meta.main && (process.env.CI || !process.argv.includes("--if-ci"))) {
  const answer = await askServer();
  BillingOfferSchema.parse(answer);
  const next = nextSnapshot(answer, current);
  if (next.trial !== answer.trial) {
    console.warn(
      "::warning::The server offers no trial right now, so this copy keeps the trial it had.",
    );
  }
  if (isDeepStrictEqual(next, current)) {
    console.log(`The offer copy is current (${next.offerVersion}).`);
  } else {
    writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(
      `Wrote the offer copy: ${current.offerVersion} to ${next.offerVersion}.`,
    );
  }
}
