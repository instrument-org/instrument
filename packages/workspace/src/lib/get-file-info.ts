import { VERSION_REF_QUERY_PARAM } from "@instrument-org/shared";
import { err, ok } from "neverthrow";
import path from "node:path";
import { z } from "zod";

import { type RelativePath } from "../schemas/paths";
import { type ProjectSubdomain } from "../schemas/subdomains";
import { TypedError } from "./errors";
import { getMimeType } from "./get-mime-type";
import { urlsForSubdomain } from "./url-for-subdomain";

export const FileInfoSchema = z.object({
  filename: z.string(),
  filePath: z.string(),
  mimeType: z.string(),
  url: z.string(),
  versionRef: z.string(),
});

export const CurrentFileInfoSchema = FileInfoSchema.omit({
  versionRef: true,
});

export function getCurrentFileInfo({
  filePath,
  projectSubdomain,
}: {
  filePath: RelativePath;
  projectSubdomain: ProjectSubdomain;
}) {
  return getBaseFileInfo({
    filePath,
    projectSubdomain,
  });
}

export function getFileInfo({
  filePath,
  projectSubdomain,
  versionRef,
}: {
  filePath: RelativePath;
  projectSubdomain: ProjectSubdomain;
  versionRef?: string;
}) {
  const result = getBaseFileInfo({
    filePath,
    projectSubdomain,
    versionRef,
  });

  if (result.isErr()) {
    return result;
  }

  return ok({
    ...result.value,
    versionRef: versionRef ?? "",
  });
}

function getBaseFileInfo({
  filePath,
  projectSubdomain,
  versionRef,
}: {
  filePath: RelativePath;
  projectSubdomain: ProjectSubdomain;
  versionRef?: string;
}) {
  const urls = urlsForSubdomain(projectSubdomain);
  const cleanPath = filePath.startsWith("./") ? filePath.slice(2) : filePath;
  const baseUrl = `${urls.assetBase}/${cleanPath}`;
  const url = versionRef
    ? `${baseUrl}?${VERSION_REF_QUERY_PARAM}=${versionRef}`
    : baseUrl;

  const filename = path.basename(filePath);
  const mimeType = getMimeType(filename);

  if (!filename) {
    return err(new TypedError.NotFound("File path has no filename"));
  }

  return ok({
    filename,
    filePath,
    mimeType,
    url,
  });
}
