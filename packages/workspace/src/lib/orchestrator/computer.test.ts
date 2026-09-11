import path from "node:path";
import { describe, expect, it } from "vitest";

import { accessIn, type AttachedRoot } from "./computer";

// Host paths in the running platform's own separators, which is what the
// listing and the grants both carry: a Windows grant is `C:\Users\casey\Documents`
// and its children are spelled the same way.
const home = path.resolve(path.sep, "Users", "casey");
const documents = path.join(home, "Documents");
const roots: AttachedRoot[] = [
  { grant: "read-only", mountPoint: "/mnt/Home", root: home },
  { grant: "read-only", mountPoint: "/mnt/Documents", root: documents },
];

describe("accessIn", () => {
  it("is the granted folder itself", () => {
    expect(accessIn(roots, documents)).toEqual({
      access: "read-only",
      mountPath: "/mnt/Documents",
      root: documents,
    });
  });

  it("reaches a file under the grant through it, in the agent's separators", () => {
    expect(accessIn(roots, path.join(documents, "reports", "q3.pdf"))).toEqual({
      access: "read-only",
      mountPath: "/mnt/Documents/reports/q3.pdf",
      root: documents,
    });
  });

  it("picks the deepest grant when two cover the path", () => {
    expect(accessIn(roots, path.join(documents, "a.txt"))?.root).toBe(
      documents,
    );
    expect(accessIn(roots, path.join(home, "Desktop", "a.txt"))?.root).toBe(
      home,
    );
  });

  it("does not read a sibling sharing the grant's name as a prefix as inside it", () => {
    expect(accessIn(roots, path.join(home, "Documents-old", "a.txt"))).toEqual({
      access: "read-only",
      mountPath: "/mnt/Home/Documents-old/a.txt",
      root: home,
    });
    expect(
      accessIn(
        [{ grant: "read-only", mountPoint: "/mnt/Documents", root: documents }],
        path.join(home, "Documents-old", "a.txt"),
      ),
    ).toBeUndefined();
  });

  it("is nothing outside every grant", () => {
    expect(
      accessIn(roots, path.resolve(path.sep, "Users", "other", "a.txt")),
    ).toBeUndefined();
  });
});
