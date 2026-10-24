import { toast } from "@/client/lib/toast";
import { rpcClient, type RPCInput } from "@/client/rpc/client";

/**
 * The website's billing pages, opened in the person's browser and signed in
 * as them (`billing.openWebsite`). Choosing, buying and changing a plan all
 * happen there; the app reads the result back from the billing status.
 */
function openWebsite(input: RPCInput["billing"]["openWebsite"]) {
  rpcClient.billing.openWebsite.call(input).catch((error: unknown) => {
    toast.error("Couldn't open the website", { cause: error });
  });
}

/** Where a plan is chosen or a trial started, with `plan` leading when given. */
export function openPlans(plan?: string) {
  openWebsite({ page: "plans", ...(plan && { plan }) });
}

/** The account's own page: its plan, changing or resuming it, and billing. */
export function openAccount() {
  openWebsite({ page: "account" });
}
