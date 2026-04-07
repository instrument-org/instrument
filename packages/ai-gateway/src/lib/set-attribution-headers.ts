import { ATTRIBUTION_NAME, ATTRIBUTION_URL } from "@instrument-org/shared";

export function setAttributionHeaders(headers: Headers) {
  headers.set("X-Title", ATTRIBUTION_NAME);
  headers.set("HTTP-Referer", ATTRIBUTION_URL);
}
