import { type StudioPath } from "@/shared/studio-path";
import { is } from "@electron-toolkit/utils";
import path from "node:path";
import url from "node:url";

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
    const fileUrl = url.format({
      pathname: path.join(import.meta.dirname, rendererPath),
      protocol: "file:",
      slashes: true,
    });
    const baseUrl = new URL(fileUrl);
    baseUrl.hash = hash;
    return baseUrl.toString();
  }
}
