import { expect, it } from "vitest";

import { commandPaths } from "./preflight";

it.each([
  [
    "cat ~/Documents/Clients/a.pdf",
    [{ op: "read", path: "~/Documents/Clients/a.pdf" }],
  ],
  [
    "cp '/Users/sam/Desktop/my file.txt' work/ && echo done > /Users/sam/out.txt",
    [
      { op: "write", path: "/Users/sam/out.txt" },
      { op: "read", path: "/Users/sam/Desktop/my file.txt" },
    ],
  ],
  [
    "mv ./a.txt ../b/",
    [
      { op: "read", path: "./a.txt" },
      { op: "write", path: "../b/" },
    ],
  ],
  [
    "rm -rf /Users/sam/Downloads/old",
    [{ op: "write", path: "/Users/sam/Downloads/old" }],
  ],
  ["ls work | wc -l", []],
  ["ls /Volumes/Backup 2>&1 | head; cat x 2>/dev/null", [{ op: "read", path: "/Volumes/Backup" }]],
  [
    "cd /Volumes/Backup/Receipts && echo 5 > total.txt",
    [{ base: "/Volumes/Backup/Receipts", op: "write", path: "total.txt" }],
  ],
])("%s", (command, expected) => {
  expect(commandPaths(command)).toEqual(expected);
});
