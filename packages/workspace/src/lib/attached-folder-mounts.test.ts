import { describe, expect, it } from "vitest";

import { attachedFolderMountPoint } from "./attached-folder-mounts";

describe("attachedFolderMountPoint", () => {
  it.each([
    ["Family Photos", "/mnt/Family Photos"],
    // A chat's task holds a folder at the chat's own path for it.
    ["Home/Downloads", "/mnt/Home/Downloads"],
    // Nothing a name holds reaches outside the mounts.
    ["../etc", "/mnt/folder/etc"],
    ["Home//x", "/mnt/Home/folder/x"],
  ])("mounts %s at %s", (name, mountPoint) => {
    expect(attachedFolderMountPoint(name)).toBe(mountPoint);
  });
});
