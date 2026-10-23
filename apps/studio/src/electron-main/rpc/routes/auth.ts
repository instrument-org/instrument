import { liveRead } from "@instrument-org/workspace/electron";
import {
  cancelSignInSocial,
  finishOnWeb as finishOnWebFn,
  signInSocial as signInSocialFn,
  signOut as signOutFn,
} from "@/electron-main/auth/client";
import { hasToken as hasTokenUtil } from "@/electron-main/platform-api/utils";
import { base } from "@/electron-main/rpc/base";

import { publisher } from "../publisher";

const signOut = base.handler(async () => {
  await signOutFn();
});

const hasToken = base.handler(() => {
  return hasTokenUtil();
});

const live = {
  hasToken: base.handler(async function* ({ signal }) {
    yield* liveRead({
      changes: [
        publisher.subscribe("session.apiBearerToken.updated", { signal }),
      ],
      read: hasTokenUtil,
    });
  }),
};

const signInSocial = base.handler(async ({ errors }) => {
  try {
    return await signInSocialFn();
  } catch (error) {
    throw errors.API_ERROR({
      cause: error,
      message: error instanceof Error ? error.message : "Login failed",
    });
  }
});

/**
 * After a sign-in answered "on-web": waits while the website has the
 * account, and says how it came back.
 */
const finishOnWeb = base.handler(() => finishOnWebFn());

/** The user gave up on the sign-in waiting in their browser. */
const cancelSignIn = base.handler(() => {
  cancelSignInSocial();
});

export const auth = {
  cancelSignIn,
  finishOnWeb,
  hasToken,
  live,
  signInSocial,
  signOut,
};
