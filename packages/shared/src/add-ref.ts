import { APP_DOMAIN } from "./constants";

export const REF_PARAM_KEY = "ref";

export function addRef(url: string): string {
  try {
    const urlObj = new URL(url);
    urlObj.searchParams.set(REF_PARAM_KEY, APP_DOMAIN);
    return urlObj.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}${REF_PARAM_KEY}=${APP_DOMAIN}`;
  }
}
