import { describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { getWorkspaceConfig } from "../workspace-config";
import { hostPathArgs, parseScriptRunnerArgs } from "./utils";

createMockChatConfig(ChatIdSchema.parse("test"));

describe("hostPathArgs", () => {
  it("passes arguments through unchanged off Windows", () => {
    const args = [
      "/Users/sam/x",
      "/dev/null",
      "--env-file=/tmp/.env",
      "work/a.txt",
    ];
    expect(hostPathArgs(args)).toEqual(args);
  });

  it("respells drive paths on Windows and leaves its switches alone", () => {
    const platform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      expect(
        hostPathArgs(["/c", "ver", "/d/", "/c/Users/sam", "--out=/d/x.txt"]),
      ).toEqual(["/c", "ver", "/d/", "C:\\Users\\sam", "--out=D:\\x.txt"]);
    } finally {
      Object.defineProperty(process, "platform", { value: platform });
    }
  });
});

const KNOWN_OPTIONS = { v: { type: "boolean" } } as const;

describe("parseScriptRunnerArgs", () => {
  it("does not report unknown options that appear after the script file", () => {
    const captureException = vi.spyOn(getWorkspaceConfig(), "captureException");

    parseScriptRunnerArgs(
      "tsx",
      ["scripts/remove-background.ts", "--output", "out.png"],
      KNOWN_OPTIONS,
    );

    expect(captureException).not.toHaveBeenCalled();
    captureException.mockRestore();
  });

  it("reports unknown options that appear before the script file", () => {
    const captureException = vi.spyOn(getWorkspaceConfig(), "captureException");

    parseScriptRunnerArgs(
      "tsx",
      ["--unknown-flag", "scripts/run.ts"],
      KNOWN_OPTIONS,
    );

    expect(captureException).toHaveBeenCalledOnce();
    expect(captureException.mock.calls[0]).toMatchInlineSnapshot(
    `
      [
        [Error: Unrecognized options ignored],
        {
          "data": {
            "command": "tsx",
            "options": [
              "--unknown-flag",
            ],
          },
        },
      ]
    `);
    captureException.mockRestore();
  });
});
