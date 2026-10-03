import { getSessionStore } from "@/electron-main/stores/workspace/session";

/**
 * Forget the bearer token a request carried once the platform refused it
 * (401): a revoked or expired session then reads as signed out rather than
 * as signed in to a session that answers nothing. A token that has changed
 * since the request left (a sign-in that landed meanwhile) is kept. Says
 * whether it forgot one.
 */
export function forgetRefusedToken(sentAuthorization: null | string): boolean {
  const token = getToken();
  if (!token || sentAuthorization !== `Bearer ${token}`) {
    return false;
  }
  getSessionStore().delete("apiBearerToken");
  return true;
}

export function getToken() {
  return getSessionStore().get("apiBearerToken");
}

export function hasToken() {
  return !!getSessionStore().get("apiBearerToken");
}
