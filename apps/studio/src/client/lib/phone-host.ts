/**
 * The host a phone or a browser on the network drives this renderer against
 * (`electron-main/phone-host/`): set by `phone.tsx` before the app loads, and
 * absent in the window, where the preload hands over a message port instead.
 */
export interface PhoneHost {
  /** Where the host answers, as `http://<address>:<port>`. */
  origin: string;
  /** The bearer token every call carries. */
  token: string;
}

declare global {
  var __instrumentPhone: PhoneHost | undefined;
}

/** The phone host this page runs against, or nothing in the window. */
export function phoneHost(): PhoneHost | undefined {
  return globalThis.__instrumentPhone;
}
