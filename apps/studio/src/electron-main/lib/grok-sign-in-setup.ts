import { logger } from "@/electron-main/lib/electron-logger";
import { getAnonymousPlatformApiHeaders } from "@/electron-main/platform-api/headers";
import { z } from "zod";

/**
 * Where Sign in with Grok goes and what it asks for, served by our API so a
 * client that never upgrades can follow xAI when the flow changes, the client
 * it signs in as included. The app runs the device-code flow against xAI
 * directly, so nothing about the person reaches our servers. The values the
 * app was built with stand in whenever the API cannot be reached or answers
 * with something unusable.
 */

const log = logger.scope("grok-sign-in-setup");

const FETCH_TIMEOUT_MS = 3000;

/**
 * Only xAI's own hosts, over https: a compromised or mistaken API must not be
 * able to send a sign-in, a token, or a refresh token anywhere else.
 */
function isXAIURL(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ["x.ai", "grok.com"].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}

const XAIURLSchema = z.string().refine(isXAIURL);

export const GrokSignInSetupSchema = z.object({
  /** Where an account's tokens are spent: the Responses API and the rest. */
  apiBaseURL: XAIURLSchema,
  /** The public client the device code and tokens are asked for as. */
  clientId: z.string().min(1),
  /** Device code at `/device/code`, tokens at `/token`. */
  issuer: XAIURLSchema,
  /** How xAI tells which agent host a sign-in came from. */
  referrer: z.string().min(1),
  scope: z.string().min(1),
  /** Answers who the account is and its subscription tier (`subscriptionTier`). */
  userURL: XAIURLSchema,
});
export type GrokSignInSetup = z.output<typeof GrokSignInSetupSchema>;

export const BUILT_IN_GROK_SIGN_IN_SETUP: GrokSignInSetup = {
  apiBaseURL: "https://api.x.ai/v1",
  clientId: "b1a00492-073a-47ea-816f-4c329264a828",
  issuer: "https://auth.x.ai/oauth2",
  referrer: "instrument",
  scope: "openid profile email offline_access grok-cli:access api:access",
  userURL: "https://cli-chat-proxy.grok.com/v1/user?include=subscription",
};

/**
 * The setup our API serves now, or undefined when it cannot be reached in
 * time or answers with one that fails validation. Sent without the account
 * token, so a signed-in person's sign-in stays unlinked to their account.
 */
export async function fetchGrokSignInSetup(): Promise<
  GrokSignInSetup | undefined
> {
  const base = import.meta.env.MAIN_VITE_APP_API_BASE_URL;
  if (!base) {
    return undefined;
  }
  try {
    const response = await fetch(`${base}/grok/sign-in-setup`, {
      headers: getAnonymousPlatformApiHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      log.warn(`Grok sign-in setup answered ${String(response.status)}`);
      return undefined;
    }
    const parsed = GrokSignInSetupSchema.safeParse(await response.json());
    if (!parsed.success) {
      log.warn("Grok sign-in setup failed validation", parsed.error);
      return undefined;
    }
    return parsed.data;
  } catch (error) {
    log.warn("Grok sign-in setup could not be fetched", error);
    return undefined;
  }
}
