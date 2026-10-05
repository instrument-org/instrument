import { logger } from "@/electron-main/lib/electron-logger";
import { getAnonymousPlatformApiHeaders } from "@/electron-main/platform-api/headers";
import { z } from "zod";

/**
 * Where Sign in with ChatGPT goes and what it asks for, served by our API so a
 * client that never upgrades can follow OpenAI when the flow changes. The app
 * fills in its own values (state, PKCE, redirect, host id) and opens OpenAI
 * directly, so nothing about the person or this installation reaches our
 * servers. The values the app was built with stand in whenever the API cannot
 * be reached or answers with something unusable.
 */

const log = logger.scope("chatgpt-sign-in-setup");

const FETCH_TIMEOUT_MS = 3000;

/**
 * Only OpenAI's own hosts, over https: a compromised or mistaken API must not
 * be able to send a sign-in, a token exchange, or a refresh token anywhere
 * else.
 */
function isOpenAIURL(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "openai.com" || url.hostname.endsWith(".openai.com"))
    );
  } catch {
    return false;
  }
}

const OpenAIURLSchema = z.string().refine(isOpenAIURL);

export const SignInSetupSchema = z.object({
  /**
   * Query parameters added to the authorize URL as they are. The ones the app
   * fills in for each sign-in always win over a key of the same name here.
   */
  authorizeParams: z.record(z.string(), z.string()).default({}),
  authorizeUrl: OpenAIURLSchema,
  discoveryUrl: OpenAIURLSchema,
  /** Asked for on a first sign-in; OpenAI issues a client id per account. */
  dynamicClientId: z.string().min(1),
  issuer: OpenAIURLSchema,
  /** The scope that lets a plan's tokens call the API. */
  planScope: z.string().min(1),
  resource: OpenAIURLSchema,
  scopes: z.array(z.string().min(1)).min(1),
  tokenUrl: OpenAIURLSchema,
});
export type SignInSetup = z.output<typeof SignInSetupSchema>;

const ISSUER = "https://auth.openai.com";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";

export const BUILT_IN_SIGN_IN_SETUP: SignInSetup = {
  authorizeParams: {},
  authorizeUrl: `${ISSUER}/api/accounts/authorize`,
  discoveryUrl: `${ISSUER}/.well-known/openid-configuration`,
  dynamicClientId: "dynamic_agent_client",
  issuer: ISSUER,
  planScope: PLAN_SCOPE,
  resource: "https://api.openai.com/v1",
  scopes: [
    "openid",
    "profile",
    "email",
    "offline_access",
    "resource.invoke",
    PLAN_SCOPE,
  ],
  tokenUrl: `${ISSUER}/api/accounts/oauth/token`,
};

/**
 * The setup our API serves now, or undefined when it cannot be reached in
 * time or answers with one that fails validation. Sent without the account
 * token, so a signed-in person's sign-in stays unlinked to their account.
 */
export async function fetchSignInSetup(): Promise<SignInSetup | undefined> {
  const base = import.meta.env.MAIN_VITE_APP_API_BASE_URL;
  if (!base) {
    return undefined;
  }
  try {
    const response = await fetch(`${base}/chatgpt/sign-in-setup`, {
      headers: getAnonymousPlatformApiHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      log.warn(`ChatGPT sign-in setup answered ${String(response.status)}`);
      return undefined;
    }
    const parsed = SignInSetupSchema.safeParse(await response.json());
    if (!parsed.success) {
      log.warn("ChatGPT sign-in setup failed validation", parsed.error);
      return undefined;
    }
    return parsed.data;
  } catch (error) {
    log.warn("ChatGPT sign-in setup could not be fetched", error);
    return undefined;
  }
}
