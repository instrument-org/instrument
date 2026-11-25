import { z } from "zod";

/** A server's answer that it will not register Instrument as a client. */
export interface RegistrationRefusal {
  /** The OAuth error code, when the body carried one. */
  error?: string;
  /** What the server said, when it said anything. */
  said?: string;
  status: number;
}

const ErrorBodySchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

const MAX_SAID = 500;

/** Answers that say to come back later rather than no. */
const PASSING = new Set([408, 425, 429]);

/**
 * `fetchFn`, keeping the server's answer to a dynamic client registration (RFC
 * 7591), the one request with `redirect_uris` in its body, when it is a
 * refusal. Read here because the SDK drops what tells a refusal from a fault:
 * the status, and any error code not in its own list, which registration's
 * `invalid_redirect_uri` is not, so that arrives as `server_error`.
 */
export function watchRegistration(fetchFn: typeof fetch): {
  fetch: typeof fetch;
  refusal: () => RegistrationRefusal | undefined;
} {
  let refusal: RegistrationRefusal | undefined;
  return {
    fetch: async (input, init) => {
      const response = await fetchFn(input, init);
      if (isRegistration(init)) {
        refusal = await refusalIn(response);
      }
      return response;
    },
    refusal: () => refusal,
  };
}

function isRegistration(init: Parameters<typeof fetch>[1]): boolean {
  if (init?.method !== "POST" || typeof init.body !== "string") {
    return false;
  }
  return z
    .object({ redirect_uris: z.array(z.string()) })
    .safeParse(parseJson(init.body)).success;
}

async function refusalIn(
  response: Response,
): Promise<RegistrationRefusal | undefined> {
  const { status } = response;
  if (status < 400 || status >= 500 || PASSING.has(status)) {
    return undefined;
  }
  const body = (
    await response
      .clone()
      .text()
      .catch(() => "")
  ).trim();
  const parsed = ErrorBodySchema.safeParse(parseJson(body));
  if (parsed.success) {
    const { error, error_description: description } = parsed.data;
    return { error, ...said(description), status };
  }
  return { ...said(body), status };
}

function said(text: string | undefined): { said?: string } {
  return text ? { said: text.slice(0, MAX_SAID) } : {};
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
