import { err, ok } from "neverthrow";

import {
  type AppSubdomain,
  PREVIEW_SUBDOMAIN_PART,
} from "../schemas/subdomains";
import { TypedError } from "./errors";

export function folderNameForSubdomain(subdomain: AppSubdomain) {
  // Handle preview subdomains which have format: {name}.preview
  if (subdomain.endsWith(`.${PREVIEW_SUBDOMAIN_PART}`)) {
    const [previewPart] = subdomain.split(".");
    if (!previewPart) {
      return err(new TypedError.Parse("Invalid preview subdomain format"));
    }
    return ok(previewPart);
  }

  // Handle project subdomains (no prefix, just the subdomain part)
  return ok(subdomain);
}
