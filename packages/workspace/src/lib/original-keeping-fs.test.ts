import { InMemoryFs } from "just-bash";
import { describe, expect, it } from "vitest";

import { MOST_COPIED_BYTES } from "./file-versions";
import { originalKeepingFs } from "./original-keeping-fs";

/** A mount at `/home/me` holding `notes.md` ("A") and a `docs` folder. */
async function mount() {
  const delegate = new InMemoryFs({ "/docs/.keep": "", "/notes.md": "A" });
  const kept: { before?: string; hostPath: string }[] = [];
  const fs = originalKeepingFs({
    delegate,
    hostRoot: "/home/me",
    keep: async ({ bytes, hostPath }) => {
      // What the file holds while the write waits on the copy.
      kept.push({
        ...(bytes && { before: new TextDecoder().decode(bytes) }),
        hostPath,
      });
      await Promise.resolve();
      return true;
    },
  });
  return { delegate, fs, kept };
}

describe("originalKeepingFs", () => {
  it("hands over what a file held before its first write, and only the first", async () => {
    const { fs, kept } = await mount();
    await fs.writeFile("/notes.md", "B");
    await fs.appendFile("/notes.md", "C");
    expect(kept).toEqual([{ before: "A", hostPath: "/home/me/notes.md" }]);
    expect(await fs.readFile("/notes.md")).toBe("BC");
  });

  it("names a path that is no file yet, with nothing to keep", async () => {
    const { fs, kept } = await mount();
    await fs.writeFile("/new.md", "N");
    expect(kept).toEqual([{ hostPath: "/home/me/new.md" }]);
  });

  it("keeps what a copy or a move lands on, in a folder under the source's name", async () => {
    const { delegate, fs, kept } = await mount();
    await delegate.writeFile("/docs/notes.md", "old");
    await fs.cp("/notes.md", "/docs");
    await fs.mv("/docs/notes.md", "/moved.md");
    expect(kept).toEqual([
      { before: "old", hostPath: "/home/me/docs/notes.md" },
      { hostPath: "/home/me/moved.md" },
    ]);
  });

  it("passes a file too big to copy over without reading it", async () => {
    const { delegate, fs, kept } = await mount();
    await delegate.writeFile("/big.bin", new Uint8Array(MOST_COPIED_BYTES + 1));
    await fs.writeFile("/big.bin", "small");
    expect(kept).toEqual([{ hostPath: "/home/me/big.bin" }]);
  });

  it("reads no more files once keep takes no more", async () => {
    const delegate = new InMemoryFs({ "/a.md": "A", "/b.md": "B" });
    const kept: string[] = [];
    const fs = originalKeepingFs({
      delegate,
      hostRoot: "/home/me",
      keep: ({ hostPath }) => {
        kept.push(hostPath);
        return Promise.resolve(false);
      },
    });
    await fs.writeFile("/a.md", "1");
    await fs.writeFile("/b.md", "2");
    expect(kept).toEqual(["/home/me/a.md"]);
  });

  it("writes when keeping fails", async () => {
    const delegate = new InMemoryFs({ "/notes.md": "A" });
    const fs = originalKeepingFs({
      delegate,
      hostRoot: "/home/me",
      keep: () => Promise.reject(new Error("disk full")),
    });
    await fs.writeFile("/notes.md", "B");
    expect(await fs.readFile("/notes.md")).toBe("B");
  });
});
