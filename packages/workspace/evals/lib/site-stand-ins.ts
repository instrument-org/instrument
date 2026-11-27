/**
 * Real sites a case stands in for, at their real addresses: the run's shared
 * Chrome resolves each host to one HTTPS server on loopback and takes its
 * certificate, so an agent that opens https://x.com gets the case's page
 * rather than the real site, which a run can never be signed in to. A host
 * answers every path with its page, and `www.` answers as the host itself.
 *
 * Each host has the page it shows before a sign-in on the case's card is
 * answered, and may have another for after (`signIn`), for a site the
 * sign-in leaves signed in.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

/** What a host answers with: one page, or one before the sign-in and one after. */
export type SitePage = string | { afterSignIn: string; before: string };

export interface SiteStandIns {
  /** The flags that point the shared Chrome at this server for every host. */
  chromeArgs: string[];
  close: () => Promise<void>;
  /** From now on each host shows its page for after the sign-in. */
  signedIn: () => void;
}

export async function serveSiteStandIns(
  sites: Record<string, SitePage>,
): Promise<SiteStandIns> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "site-stand-ins-"));
  const key = path.join(dir, "key.pem");
  const cert = path.join(dir, "cert.pem");
  // The certificate names nothing Chrome checks: the shared Chrome is told
  // to take any, since it stands in for sites whose real ones it cannot have.
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-days",
      "2",
      "-subj",
      "/CN=site stand-in",
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { stdio: "ignore" },
  );
  let afterSignIn = false;
  const server = https.createServer(
    { cert: fs.readFileSync(cert), key: fs.readFileSync(key) },
    (request, response) => {
      const host = (request.headers.host ?? "")
        .replace(/:\d+$/, "")
        .replace(/^www\./, "");
      const page = sites[host];
      if (page === undefined) {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end(`No stand-in for ${host}`);
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        typeof page === "string"
          ? page
          : afterSignIn
            ? page.afterSignIn
            : page.before,
      );
    },
  );
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo; // listen() on a port always has an AddressInfo
  const rules = Object.keys(sites).flatMap((host) => [
    `MAP ${host} 127.0.0.1:${port}`,
    `MAP www.${host} 127.0.0.1:${port}`,
  ]);
  return {
    chromeArgs: [
      `--host-resolver-rules=${rules.join(", ")}`,
      "--ignore-certificate-errors",
    ],
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dir, { force: true, recursive: true });
    },
    signedIn: () => {
      afterSignIn = true;
    },
  };
}
