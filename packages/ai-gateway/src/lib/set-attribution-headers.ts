import { APP_URL, ATTRIBUTION_NAME } from "@instrument-org/shared";

export function setAttributionHeaders(headers: Headers) {
  headers.set("X-Title", ATTRIBUTION_NAME);
  headers.set("HTTP-Referer", APP_URL);
}
