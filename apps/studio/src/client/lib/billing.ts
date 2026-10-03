import { type RPCOutput } from "@/client/rpc/client";

type Offer = RPCOutput["billing"]["offer"];

/** A plan key as a person reads it: the offer's product name when it has one. */
export function planLabel(planKey: string, offer: Offer | undefined) {
  if (planKey === "trial") {
    return "Free trial";
  }
  if (planKey === "none") {
    return "No plan";
  }
  return offer?.plans.find((plan) => plan.key === planKey)?.name ?? planKey;
}

/** `$10/month`, or nothing while Stripe's price has not been cached yet. */
export function formatPlanPrice(price: Offer["plans"][number]["price"]) {
  if (!price || price.unitAmount === null) {
    return "";
  }
  const amount = new Intl.NumberFormat(undefined, {
    currency: price.currency,
    style: "currency",
  }).format(price.unitAmount / 100);
  return price.interval ? `${amount}/${price.interval}` : amount;
}
