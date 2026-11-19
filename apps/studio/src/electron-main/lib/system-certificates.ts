import tls from "node:tls";

import { logger } from "./electron-logger";

/**
 * Adds the certificates this computer trusts to the ones Node trusts, so the
 * main process's requests get through a company network that inspects TLS
 * with its own root, as Chromium's already do. Node otherwise trusts only
 * its bundled list, and every model call there fails with
 * `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. Reading the system store takes about
 * 12 ms, and it runs before the first connection.
 */
export function trustSystemCertificates() {
  try {
    const bundled = tls.getCACertificates("default");
    const system = tls.getCACertificates("system");
    tls.setDefaultCACertificates([...new Set([...bundled, ...system])]);
    logger.info(`Trusting ${system.length} certificates from the system store`);
  } catch (error) {
    logger.warn("Couldn't read the system's certificates", error);
  }
}
