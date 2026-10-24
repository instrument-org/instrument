import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import { z } from "zod";

import { platformApiBaseUrl, websiteBaseUrl } from "./base-url";
import { getPlatformApiHeaders } from "./headers";
import { getToken } from "./utils";

const WebLinkSchema = z.object({ url: z.string() });

/**
 * The address that opens `path` (`/account?port=…`) on the website. Signed
 * in, a single-use link from the API that signs the browser in to the
 * website on the way; signed out, or when the API won't make one, the page
 * itself, where the website asks the person to sign in.
 */
export async function websitePageUrl(path: string): Promise<string> {
  const unsigned = `${websiteBaseUrl()}${path}`;
  if (!getToken()) {
    return unsigned;
  }
  try {
    const response = await fetch(
      `${platformApiBaseUrl()}/auth/web-link/create`,
      {
        body: JSON.stringify({ path }),
        headers: {
          ...getPlatformApiHeaders(),
          "content-type": "application/json",
        },
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Web link creation failed with ${response.status}`);
    }
    return WebLinkSchema.parse(await response.json()).url;
  } catch (error) {
    captureServerException(
      new Error("Couldn't make a signed-in website link", { cause: error }),
      { area: "auth" },
    );
    return unsigned;
  }
}
