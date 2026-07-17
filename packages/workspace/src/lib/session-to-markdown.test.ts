import { describe, expect, it } from "vitest";

import { renderToolOutput } from "./session-to-markdown";

describe("renderToolOutput", () => {
  it("records content text and media metadata without exporting media bytes", () => {
    expect(
      renderToolOutput({
        type: "content",
        value: [
          {
            text: "Image file: work/pdf-preview/page-001.png.",
            type: "text",
          },
          {
            data: "base64-image-data",
            mediaType: "image/png",
            type: "media",
          },
        ],
      }),
    ).toMatchInlineSnapshot(`
      [
        "\`\`\`markdown
      Image file: work/pdf-preview/page-001.png.
      \`\`\`",
        "*[1 media attachment omitted from transcript: image/png]*",
      ]
    `);
  });
});
