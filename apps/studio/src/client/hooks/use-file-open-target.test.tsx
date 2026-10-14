import { rpcClient } from "@/client/rpc/client";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../tests/render";
import {
  sharedApps,
  useSharedFileOpenCandidates,
} from "./use-file-open-target";

const app = (name: string, isDefault = false) => ({
  appName: name,
  appPath: `/Applications/${name}.app`,
  iconUrl: null,
  isDefault,
});

describe("sharedApps", () => {
  it("keeps the apps every file opens in, the default only where it is every one's", () => {
    expect(
      sharedApps([
        [app("Preview", true), app("Safari"), app("Zed")],
        [app("Zed", true), app("Preview")],
      ]).map((each) => [each.appName, each.isDefault]),
    ).toMatchInlineSnapshot(`
      [
        [
          "Preview",
          false,
        ],
        [
          "Zed",
          false,
        ],
      ]
    `);
  });

  it("keeps the default when every file shares it", () => {
    expect(
      sharedApps([[app("Zed", true)], [app("Zed", true), app("Preview")]]),
    ).toEqual([app("Zed", true)]);
  });
});

function AskAbout({ files }: { files: string[] }) {
  useSharedFileOpenCandidates(
    files.map((hostPath) => ({ hostPath })),
    { enabled: true },
  );
  return null;
}

describe("useSharedFileOpenCandidates", () => {
  // The system answers by type, so a file is asked about only when no file
  // before it has its extension.
  it.each([
    // A backslash is a character a name can hold on a Mac or Linux, so the
    // second file is called `draft\.md`, a Markdown file like the first.
    [["/Users/sam/notes.md", "/Users/sam/draft\\.md"], ["/Users/sam/notes.md"]],
    // On Windows it is a separator, and a file called `.md` has no extension.
    [
      ["C:\\Users\\sam\\notes.md", "C:\\Users\\sam\\draft\\.md"],
      ["C:\\Users\\sam\\notes.md", "C:\\Users\\sam\\draft\\.md"],
    ],
  ])("of %j asks about %j", (files, asked) => {
    const { queryClient } = renderWithProviders(<AskAbout files={files} />);
    expect(
      files.filter((filePath) =>
        queryClient.getQueryCache().find({
          exact: true,
          queryKey: rpcClient.utils.fileOpenCandidates.queryKey({
            input: { filePath },
          }),
        }),
      ),
    ).toEqual(asked);
  });
});
