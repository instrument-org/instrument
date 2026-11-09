import { describe, expect, it } from "vitest";

import { chatMenuGroups } from "./chat-actions";
import { type RowAction } from "./row-shell";

const ids = ["archive", "read", "star", "reveal", "feedback"];

describe("chatMenuGroups", () => {
  it("puts every action a chat offers into one of its menu groups", () => {
    const actions = ids.map(
      (id): RowAction => ({ icon: null, id, label: id, run: () => {} }),
    );
    const groups = chatMenuGroups(actions);
    expect(
      Object.fromEntries(
        Object.entries(groups).map(([name, list]) => [
          name,
          list.map((action) => action.id),
        ]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "feedback": [
          "feedback",
        ],
        "files": [
          "reveal",
        ],
        "marks": [
          "read",
          "star",
        ],
        "put": [
          "archive",
        ],
      }
    `);
  });
});
