import { type RelativePath } from "../schemas/paths";

export function fixRelativePath(path: string): null | RelativePath {
  if (isRepoRelativePath(path)) {
    return path;
  }

  // Check if path starts with a leading slash and convert it to "./"
  if (path.startsWith("/")) {
    path = `.${path}`;
  }

  // Check if path doesn't start with "./" and add it
  if (!path.startsWith("./")) {
    path = `./${path}`;
  }

  if (isRepoRelativePath(path)) {
    return path;
  }

  return null;
}

// Substring checks miss a `..` that is not followed by a forward slash: `".."`
// itself, and `"..\\x"` on Windows where the backslash is a separator. Split on
// both separators and reject the segment, matching `RelativeTaskPathSchema`.
function hasParentSegment(path: string): boolean {
  return path.split(/[/\\]/).includes("..");
}

function isRepoRelativePath(path: string): path is RelativePath {
  // Check if path is a string, starts with './', and doesn't contain any path traversal patterns
  return (
    typeof path === "string" &&
    path.startsWith("./") &&
    !hasParentSegment(path) &&
    !path.includes("//") &&
    !/[<>:"|?*]/.test(path)
  );
}
