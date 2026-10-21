import { type StudioPath } from "@/shared/studio-path";
import { is } from "@electron-toolkit/utils";

import { rendererBaseURL } from "./renderer-host";

export function studioURL(pathname: StudioPath) {
  return createBaseURL("../renderer/index.html", pathname);
}

function createBaseURL(rendererPath: string, hash = "") {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    const baseUrl = new URL(process.env.ELECTRON_RENDERER_URL);
    baseUrl.pathname = rendererPath;
    baseUrl.hash = hash;
    return baseUrl.toString();
  } else {
    const baseUrl = new URL("index.html", rendererBaseURL());
    baseUrl.hash = hash;
    return baseUrl.toString();
  }
}
