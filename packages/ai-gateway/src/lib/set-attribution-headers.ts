import { APP_NAME, APP_URL } from "@instrument-org/shared";

export function setAttributionHeaders(headers: Headers) {
  headers.set("X-Title", APP_NAME);
  headers.set("HTTP-Referer", APP_URL);
}
