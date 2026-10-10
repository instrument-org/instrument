/**
 * The decision models the product reaches, and how far each one's request
 * can go. Limits come from each provider's own refusals and change without
 * notice: a model that starts failing every case has usually tightened one.
 */
export interface DecisionModel {
  id: string;
  /** Most options one choice question may carry. */
  maxOptions: number;
  /** Most questions one request may carry; a larger ask is split and sent in parallel. */
  maxQuestions: number;
  /**
   * List price per million input tokens, for a route whose response carries
   * no cost of its own. OpenRouter reports what each call cost.
   */
  pricePerMillion?: number;
  route: "openrouter" | "workers-ai";
}

/**
 * The product sends at most 500 questions a request (the API refuses more
 * than 512), so a model that takes more is still asked in 500s.
 */
const PRODUCT_MAX_QUESTIONS = 500;
const PRODUCT_MAX_OPTIONS = 255;

const openRouter = (
  id: string,
  limits: { maxOptions?: number; maxQuestions?: number } = {},
): DecisionModel => ({
  id,
  maxOptions: limits.maxOptions ?? PRODUCT_MAX_OPTIONS,
  maxQuestions: limits.maxQuestions ?? PRODUCT_MAX_QUESTIONS,
  route: "openrouter",
});

export const DECISION_MODELS: DecisionModel[] = [
  // What an OpenRouter key reaches.
  openRouter("typesafe/jev-1.13"),
  // Workers AI directly, which is what the Instrument API calls through its
  // binding.
  {
    id: "cf:clef-flash",
    maxOptions: PRODUCT_MAX_OPTIONS,
    maxQuestions: 64,
    pricePerMillion: 0.09,
    route: "workers-ai",
  },
  {
    id: "cf:clef",
    maxOptions: PRODUCT_MAX_OPTIONS,
    maxQuestions: 64,
    pricePerMillion: 0.24,
    route: "workers-ai",
  },
];

export function findModel(id: string): DecisionModel {
  const known = DECISION_MODELS.find((model) => model.id === id);
  if (known) {
    return known;
  }
  // An id not in the list runs with the product's limits, so a new model can
  // be tried before it is added; a refusal names the limit it needs.
  return id.startsWith("cf:")
    ? {
        id,
        maxOptions: PRODUCT_MAX_OPTIONS,
        maxQuestions: 64,
        route: "workers-ai",
      }
    : openRouter(id);
}
