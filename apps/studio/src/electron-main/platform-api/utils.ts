import { platformApiOrigin } from "@/electron-main/platform-api/base-url";
import {
  forgetSessionToken,
  getSessionToken,
} from "@/electron-main/stores/workspace/session";

/**
 * Forget the bearer token a request carried once the platform refused it
 * (401): a revoked or expired session then reads as signed out rather than
 * as signed in to a session that answers nothing. A token that has changed
 * since the request left (a sign-in that landed meanwhile) is kept, and so
 * is every other server's sign-in. Says whether it forgot one.
 */
export function forgetRefusedToken(sentAuthorization: null | string): boolean {
  const token = getToken();
  if (!token || sentAuthorization !== `Bearer ${token}`) {
    return false;
  }
  forgetSessionToken(platformApiOrigin());
  return true;
}

/** The bearer token of the sign-in to the server this process talks to. */
export function getToken() {
  return getSessionToken(platformApiOrigin());
}

export function hasToken() {
  return !!getToken();
}
