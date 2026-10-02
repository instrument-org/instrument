import { err, ok, type Result } from "neverthrow";

import { TypedError } from "./errors";

// Folder name = display name, so we reject invalid chars rather than transform:
// what the user types lands on disk verbatim. Cross-OS illegal set + controls.
// eslint-disable-next-line no-control-regex
const ILLEGAL_CHARS = new RegExp('[<>:"/\\\\|?*\\u0000-\\u001f]');
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_LENGTH = 200;

/**
 * A name that is also the name of its folder on disk, for anything kept that
 * way: rejected rather than transformed, so what the user typed is what they
 * find in their file manager. `label` starts each message ("Topic name…").
 */
export function validateFolderName(
  raw: string,
  label: string,
): Result<string, TypedError.InvalidInput> {
  const name = raw.trim();

  if (name.length === 0) {
    return err(new TypedError.InvalidInput(`${label} name can't be empty`));
  }
  if (name.length > MAX_LENGTH) {
    return err(
      new TypedError.InvalidInput(
        `${label} name must be ${MAX_LENGTH} characters or fewer`,
      ),
    );
  }
  if (name === "." || name === "..") {
    return err(
      new TypedError.InvalidInput(
        `"." and ".." are not valid ${label.toLowerCase()} names`,
      ),
    );
  }
  if (ILLEGAL_CHARS.test(name)) {
    return err(
      new TypedError.InvalidInput(
        `${label} name can't contain any of: < > : " / \\ | ? *`,
      ),
    );
  }
  if (WINDOWS_RESERVED.test(name)) {
    return err(
      new TypedError.InvalidInput(
        `"${name}" is a reserved name and can't be used`,
      ),
    );
  }
  if (name.endsWith(".") || name.endsWith(" ")) {
    return err(
      new TypedError.InvalidInput(
        `${label} name can't end with a space or period`,
      ),
    );
  }

  return ok(name);
}
