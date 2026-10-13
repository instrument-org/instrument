import { type DecisionModel } from "./models";

export interface Question {
  criteria?: unknown;
  instructions: unknown;
  type: "choice" | "noul" | "score";
}

export interface Answer {
  choice?: string;
  noul?: number;
  probabilities?: Record<string, number>;
  score?: number;
  type: Question["type"];
}

export interface Asked {
  answers: Record<string, Answer>;
  /** What the calls cost, from the response or from the list price. */
  cost: number;
  inputTokens: number;
  /** The model the first response names, as a caller reading its bar would see it. */
  model: string | undefined;
  /** From the first request out to the last answer in, as a person waits for it. */
  ms: number;
  requests: number;
  /** Requests sent again after a 429 or a 5xx. */
  retries: number;
}

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];
/**
 * Longer than any decision answered in practice. Some providers stall a
 * request for good rather than fail it, and one such request would otherwise
 * hold the whole run; a timed-out request is sent again once.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * One decision as the product makes it, asked of `model`: the questions are
 * split into as many requests as the model's cap needs and sent at once, the
 * way the Instrument API splits an ask for Clef, and the answers merged.
 * Against `cf:` the model is the one named, where the API would choose
 * between the two by the question count.
 */
export async function ask(
  model: DecisionModel,
  body: { questions: Record<string, Question>; state: unknown },
): Promise<Asked> {
  const entries = Object.entries(body.questions);
  // Evenly, as the product splits a long search, so no slice is a stub.
  const size = Math.ceil(
    entries.length /
      Math.max(1, Math.ceil(entries.length / model.maxQuestions)),
  );
  const slices: Record<string, Question>[] = [];
  for (let start = 0; start < entries.length; start += size) {
    slices.push(Object.fromEntries(entries.slice(start, start + size)));
  }
  const started = performance.now();
  const results = await Promise.all(
    slices.map((questions) =>
      requestOnce(model, { questions, state: body.state }),
    ),
  );
  return {
    answers: results.reduce<Record<string, Answer>>(
      (merged, result) => ({ ...merged, ...result.answers }),
      {},
    ),
    cost: results.reduce((sum, result) => sum + result.cost, 0),
    inputTokens: results.reduce((sum, result) => sum + result.inputTokens, 0),
    model: results[0]?.model,
    ms: Math.round(performance.now() - started),
    requests: slices.length,
    retries: results.reduce((sum, result) => sum + result.retries, 0),
  };
}

async function requestOnce(
  model: DecisionModel,
  body: { questions: Record<string, Question>; state: unknown },
) {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await send(model, body);
    } catch (error) {
      // Once only: a provider that stalls one request tends to stall the next.
      const delay = attempt === 0 ? RETRY_DELAYS_MS[0] : undefined;
      if (
        !(error instanceof DOMException && error.name === "TimeoutError") ||
        delay === undefined
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (response.ok) {
      const json = (await response.json()) as {
        answers?: Record<string, Answer>;
        model?: string;
        result?: {
          answers?: Record<string, Answer>;
          model?: string;
          usage?: { cost?: number; input_tokens?: number };
        };
        usage?: { cost?: number; input_tokens?: number };
      };
      // Workers AI wraps the decision response in `result`.
      const result = json.result ?? json;
      const inputTokens = result.usage?.input_tokens ?? 0;
      return {
        answers: result.answers ?? {},
        cost:
          result.usage?.cost ??
          (inputTokens * (model.pricePerMillion ?? 0)) / 1_000_000,
        inputTokens,
        model: result.model,
        retries: attempt,
      };
    }
    const retryable = response.status === 429 || response.status >= 500;
    const delay = RETRY_DELAYS_MS[attempt];
    if (!retryable || delay === undefined) {
      const detail = await response.text();
      throw new Error(`${response.status}: ${detail.slice(0, 300)}`);
    }
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

function send(model: DecisionModel, body: unknown): Promise<Response> {
  if (model.route === "workers-ai") {
    const name = model.id.replace(/^cf:/u, "");
    return fetch(
      `https://api.cloudflare.com/client/v4/accounts/${requireEnv("CLOUDFLARE_ACCOUNT_ID")}/ai/run/@cf/cloudflare/${name}`,
      {
        body: JSON.stringify({ ...(body as object), model: name }),
        headers: {
          Authorization: `Bearer ${requireEnv("CLOUDFLARE_WORKERS_AI_API_KEY")}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  }
  return fetch("https://openrouter.ai/api/v1/systemone", {
    body: JSON.stringify({ ...(body as object), model: model.id }),
    headers: {
      Authorization: `Bearer ${requireEnv("APP_OPENROUTER_API_KEY")}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set (packages/workspace/.env)`);
  }
  return value;
}
