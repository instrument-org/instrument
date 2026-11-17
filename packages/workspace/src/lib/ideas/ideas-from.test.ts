import { describe, expect, it } from "vitest";

import { ideasFrom } from "./ideas-from";

const ECHOES = {
  instruction: "- Never repeat a title back.",
  titles: ["Ledgerly pricing", "Budget 2027.xlsx"],
};

const read = (...answers: string[]) =>
  Object.fromEntries(
    answers.map((answer) => [answer, ideasFrom(answer, ECHOES)]),
  );

describe("ideasFrom", () => {
  it("keeps specific lines, at most three, and cleans them", () => {
    expect(
      read(
        "Find the cheapest plan for 12 users\nCompare Growth vs Scale plan features\nCheck if nonprofit 30% discount applies\nList every vendor over $10k",
        "1. Find the cheapest plan for 12 users\n- Draft a reply to Dana about the invoice",
        "NONE",
      ),
    ).toMatchInlineSnapshot(`
      {
        "1. Find the cheapest plan for 12 users
      - Draft a reply to Dana about the invoice": [
          "Find the cheapest plan for 12 users",
          "Draft a reply to Dana about the invoice",
        ],
        "Find the cheapest plan for 12 users
      Compare Growth vs Scale plan features
      Check if nonprofit 30% discount applies
      List every vendor over $10k": [
          "Find the cheapest plan for 12 users",
          "Compare Growth vs Scale plan features",
          "Check if nonprofit 30% discount applies",
        ],
        "NONE": [],
      }
    `);
  });

  it("drops generic filler", () => {
    expect(
      read(
        "Summarize this page\nExplain this\nWhat is this about?",
        "Tell me more\nTL;DR\nKey takeaways",
        "Summarize the article for me\nSummarize the Q3 variance in Budget 2027",
      ),
    ).toMatchInlineSnapshot(`
      {
        "Summarize the article for me
      Summarize the Q3 variance in Budget 2027": [
          "Summarize the Q3 variance in Budget 2027",
        ],
        "Summarize this page
      Explain this
      What is this about?": [],
        "Tell me more
      TL;DR
      Key takeaways": [],
      }
    `);
  });

  it("drops what can't be taken back", () => {
    expect(
      read(
        "Delete the duplicate rows\nSend it to Sam\nBuy the Scale plan",
        "Post a summary to Slack\nPublish the draft\nReply to Dana's question",
        "Find which rows to delete first",
      ),
    ).toMatchInlineSnapshot(`
      {
        "Delete the duplicate rows
      Send it to Sam
      Buy the Scale plan": [],
        "Find which rows to delete first": [],
        "Post a summary to Slack
      Publish the draft
      Reply to Dana's question": [],
      }
    `);
  });

  it("drops talk about the context and echoes of it", () => {
    expect(
      read(
        "Based on your open tabs, compare the two plans\nFrom your activity, rename the files\nCompare the two plans",
        "Ledgerly Pricing\nTotal the Q3 column in Budget 2027",
        "Never repeat a title back\nCompare these two tabs' prices",
      ),
    ).toMatchInlineSnapshot(`
      {
        "Based on your open tabs, compare the two plans
      From your activity, rename the files
      Compare the two plans": [
          "Compare the two plans",
        ],
        "Ledgerly Pricing
      Total the Q3 column in Budget 2027": [
          "Total the Q3 column in Budget 2027",
        ],
        "Never repeat a title back
      Compare these two tabs' prices": [
          "Compare these two tabs' prices",
        ],
      }
    `);
  });

  it("drops lines too long for the corner", () => {
    expect(
      read(`Work out ${"the totals and ".repeat(6)}the average`),
    ).toMatchInlineSnapshot(`
      {
        "Work out the totals and the totals and the totals and the totals and the totals and the totals and the average": [],
      }
    `);
  });
});
