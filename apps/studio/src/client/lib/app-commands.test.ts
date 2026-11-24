import { expect, it } from "vitest";

import {
  type ComposerCommand,
  matchComposerCommands,
  projectCommand,
} from "./app-commands";

const project = projectCommand(() => {});
const feedback: ComposerCommand = {
  ...project,
  aliases: ["feedback", "bug"],
  anywhere: false,
  id: "feedback",
};

it.each([
  { atStart: true, expected: ["feedback", "project"], query: "" },
  { atStart: true, expected: ["bug"], query: "bu" },
  { atStart: false, expected: ["project"], query: "" },
  { atStart: false, expected: ["project"], query: "PRO" },
  { atStart: false, expected: [], query: "bu" },
])(
  "offers $expected for /$query with atStart $atStart",
  ({ atStart, expected, query }) => {
    expect(
      matchComposerCommands([feedback, project], { atStart, query }).map(
        (match) => match.name,
      ),
    ).toEqual(expected);
  },
);
