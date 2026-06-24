import { err, ok, type Result } from "neverthrow";

import { TypedError } from "./errors";

// Because a project's folder name IS its display name, names must be valid
// directory names across macOS, Windows, and Linux. We VALIDATE (reject) rather
// than silently transform, so what the user types is exactly what lands on disk.
// Rejects the Windows/cross-OS illegal set plus ASCII control characters.
// eslint-disable-next-line no-control-regex, prefer-regex-literals
const ILLEGAL_CHARS = new RegExp('[<>:"/\\\\|?*\\u0000-\\u001f]');
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_LENGTH = 200;

export function validateProjectName(
  raw: string,
): Result<string, TypedError.Parse> {
  const name = raw.trim();

  if (name.length === 0) {
    return err(new TypedError.Parse("Project name can't be empty"));
  }
  if (name.length > MAX_LENGTH) {
    return err(
      new TypedError.Parse(
        `Project name must be ${MAX_LENGTH} characters or fewer`,
      ),
    );
  }
  if (name === "." || name === "..") {
    return err(
      new TypedError.Parse('"." and ".." are not valid project names'),
    );
  }
  if (ILLEGAL_CHARS.test(name)) {
    return err(
      new TypedError.Parse(
        "Project name can't contain any of: < > : \" / \\ | ? *",
      ),
    );
  }
  if (WINDOWS_RESERVED.test(name)) {
    return err(
      new TypedError.Parse(`"${name}" is a reserved name and can't be used`),
    );
  }
  if (name.endsWith(".") || name.endsWith(" ")) {
    return err(
      new TypedError.Parse("Project name can't end with a space or period"),
    );
  }

  return ok(name);
}
