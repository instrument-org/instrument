import { type RPCOutput } from "@/client/rpc/client";

type Offer = RPCOutput["billing"]["offer"];
type Status = RPCOutput["billing"]["status"];

/**
 * The ways the platform can offer the free trial, and the beta offer, as `billing.offer`
 * and `billing.status` answer for an account that has never had one. The
 * `reason` is what the platform gives for refusing Instrument's models on the
 * free plan in that mode (`trial-available`, `trial-paused`).
 */
export const trialModes = [
  {
    id: "no-card",
    label: "No card",
    reason: "trial-available",
    trial: { days: 7 },
  },
  { id: "paused", label: "Paused", reason: "trial-paused", trial: null },
  // A beta tester's offer: Pro's free months, over the no-card trial.
  {
    id: "beta",
    label: "Beta offer",
    reason: "trial-available",
    trial: { days: 7 },
  },
] as const satisfies readonly {
  id: string;
  label: string;
  reason: string;
  trial: Omit<NonNullable<Offer["trial"]>, "available"> | null;
}[];

export type TrialModeId = (typeof trialModes)[number]["id"];

const windows = [{ anchor: "first_use", duration: "PT5H", key: "5h" }];

// Illustrative: the policy names each plan's models, and its makers are what
// the card marks.
const models = [
  { maker: "anthropic", name: "Claude Haiku 5.5" },
  { maker: "openai", name: "GPT-6 Luna" },
  { maker: "google", name: "Gemini" },
];

const plans: Offer["plans"] = [
  {
    allowance: { multiple: 1, windows },
    description: "For everyday work with AI.",
    features: ["Standard AI usage", "Web search", "Image generation"],
    key: "basic",
    models,
    name: "Basic",
    price: { currency: "usd", interval: "month", unitAmount: 1000 },
  },
  {
    allowance: { multiple: 4, windows },
    description: "For people who work with AI all day.",
    features: ["4× Standard AI usage", "Web search", "Image generation"],
    key: "pro",
    models,
    name: "Pro",
    price: { currency: "usd", interval: "month", unitAmount: 4000 },
  },
];

/**
 * The offer in `mode`. Signed out, the platform leaves `available` out,
 * since the question is only whether a new account could start one.
 */
export function trialModeOffer(mode: TrialModeId, signedIn: boolean): Offer {
  const { trial } = getTrialMode(mode);
  return {
    beta: mode === "beta" ? { months: 3, plan: "pro" } : null,
    offerVersion: `debug-${mode}`,
    plans,
    trial: trial && { ...trial, ...(signedIn && { available: true }) },
  };
}

/** A signed-in account on the free plan that has never started its trial. */
export function trialModeStatus(mode: TrialModeId): Status {
  return {
    canSubscribe: true,
    features: {
      decisions: { available: true },
      models: {
        available: false,
        code: "subscription-required",
        reason: getTrialMode(mode).reason,
      },
      search: { available: true },
    },
    plan: "free",
    trial: { state: "available" },
    windows: [{ key: "free", percentUsed: 10 }],
  };
}

export function getTrialMode(id: TrialModeId) {
  const mode = trialModes.find((item) => item.id === id);
  if (!mode) {
    throw new Error(`Unknown trial mode: ${id}`);
  }
  return mode;
}
