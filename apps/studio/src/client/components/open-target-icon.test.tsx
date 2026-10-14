import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../tests/render";
import { resolveFileTypeIcon } from "./extend/file-system";
import { OpenTargetIcon } from "./open-target-icon";

describe("OpenTargetIcon", () => {
  // With no app icon to show, the file's type stands in, read off its name.
  it.each([
    // A backslash is a character a name can hold on a Mac or Linux.
    ["/Users/sam/old\\Dockerfile", "old\\Dockerfile"],
    ["C:\\Users\\sam\\old\\Dockerfile", "Dockerfile"],
  ])("draws %s as a file called %s", (hostPath, name) => {
    const { container } = renderWithProviders(
      <OpenTargetIcon file={{ hostPath }} />,
    );
    expect(container.querySelector("use")?.getAttribute("href")).toBe(
      `#${resolveFileTypeIcon(name).name}`,
    );
  });
});
