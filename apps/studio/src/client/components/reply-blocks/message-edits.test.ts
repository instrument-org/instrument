import { describe, expect, it } from "vitest";

import { type EditSource, findMessageEdit } from "./message-edits";

const WORDY =
  "I am writing to you today in order to express my very strong interest in the Marketing Coordinator position that I saw posted on your website. I truly believe that I would be a really great fit for this role because of the fact that I have basically spent the last four years working in marketing at a small nonprofit organization. During that time, I was responsible for managing all of our social media accounts, and I was able to grow our Instagram following from around 2,000 to over 9,500 followers.";

const TIGHT =
  "I am writing to express my strong interest in the Marketing Coordinator position posted on your website. I would be a great fit for this role because I have spent the last four years working in marketing at a small nonprofit organization. I was responsible for managing all of our social media accounts, and I grew our Instagram following from around 2,000 to over 9,500 followers.";

const EMAIL =
  "Hi Jordan, I just wanted to quickly reach out and touch base regarding the proposal that we sent over to you last week. I was wondering if you had maybe had a chance to take a look at it yet? Also, just so you know, the pricing in the proposal is only valid until the end of the month. Thanks so much for your time, Alex";

const LANDLORD =
  "Hi, this is Marcus from Alder Street Properties. We need to do the annual smoke detector inspection in your unit. Would Thursday between 10 and 2 work for you? If not, let me know a day that does. Thanks, Marcus";

const person = (text: string): EditSource => ({ from: "person", text });
const draft = (text: string): EditSource => ({ from: "draft", text });

describe("findMessageEdit", () => {
  it("reads a draft that grew on another pass as made from the draft before it", () => {
    const shorter =
      "Hi Dana, starting March 1, the Team plan goes from $49 to $59 per seat per month. The new price covers what we added this year, including the reporting dashboard and priority support. Any questions, just reply here. Thanks, Sam";
    const warmer =
      "Hi Dana, I hope you and the team had a good fall, and thank you so much for sticking with us through a busy year of changes. I wanted you to hear this from me first: starting March 1, the Team plan goes from $49 to $59 per seat per month. The new price covers what we added this year, including the reporting dashboard and priority support, both of which we shaped around feedback from teams like yours. If it would help to talk any of it through, I'd be glad to set up a quick call at whatever time suits you, or answer anything over email. Warmly, Sam";
    const pasted =
      "Hi Dana, I just wanted to reach out and let you know that, starting on March 1, the price of the Team plan is going to be going up from $49 to $59 per seat per month. If you have any questions at all about this, please don't hesitate to reach out to me. Thanks so much, Sam";
    const edit = findMessageEdit(warmer, [
      person("Make it a bit warmer."),
      draft(shorter),
      person(`Can you tighten this before I send it to Dana? ${pasted}`),
    ]);
    expect(edit?.original.body).toBe(shorter);
    expect(edit?.stretches?.some((stretch) => stretch.kind === "new")).toBe(
      true,
    );
  });

  it("takes only the pasted text from the person's message", () => {
    const edit = findMessageEdit(TIGHT, [
      person(`Can you tighten this paragraph?\n\n${WORDY}`),
    ]);
    expect(edit?.original.body).toBe(WORDY);
  });

  it("leaves out a question sharing the pasted text's line", () => {
    const edit = findMessageEdit(TIGHT, [
      person(`Can you tighten this? ${WORDY} Thanks!`),
    ]);
    expect(edit?.original.body).toBe(`${WORDY} Thanks!`);
    expect(
      findMessageEdit(TIGHT, [person(`Tighten this: ${WORDY}`)])?.original.body,
    ).toBe(WORDY);
  });

  it("marks the new words and what they replaced, and nothing for words cut", () => {
    const edit = findMessageEdit(
      "Hi Jordan, did you get a chance to look at the proposal we sent last week? The pricing in the proposal is only valid until the end of the month. Thanks, Alex",
      [person(`Can you make this shorter?\n\n${EMAIL}`)],
    );
    expect(edit?.original.body).toBe(EMAIL);
    expect(edit?.stretches?.filter((stretch) => stretch.kind === "new"))
      .toMatchInlineSnapshot(`
      [
        {
          "kind": "new",
          "text": "did you get",
          "was": "I just wanted to quickly reach out and touch base regarding the proposal that we sent over to you last week. I was wondering if you had maybe had",
        },
        {
          "kind": "new",
          "text": "the proposal we sent last week? The",
          "was": "it yet? Also, just so you know, the",
        },
        {
          "kind": "new",
          "text": "Thanks,",
          "was": "Thanks so much for your time,",
        },
      ]
    `);
    expect(edit?.stretches?.map((stretch) => stretch.text).join("")).toBe(
      "Hi Jordan, did you get a chance to look at the proposal we sent last week? The pricing in the proposal is only valid until the end of the month. Thanks, Alex",
    );
  });

  it("finds nothing for a reply to a pasted email", () => {
    expect(
      findMessageEdit(
        "Hi Marcus, Thursday works for me, but I'm only home after noon. Could the inspection be between 12 and 2? Thanks, Sam",
        [
          person(
            `My landlord sent this. Can you write a reply saying Thursday works but I'll be home only after noon?\n\n${LANDLORD}`,
          ),
        ],
      ),
    ).toBeUndefined();
  });

  it("prefers the agent's last draft to the text pasted before it", () => {
    const second =
      "I would love to join you as Marketing Coordinator. I have spent the last four years working in marketing at a small nonprofit organization, where I grew our Instagram following from around 2,000 to over 9,500 followers.";
    const edit = findMessageEdit(second, [
      person("Shorter please, and warmer."),
      draft(TIGHT),
      person(`Can you tighten this paragraph?\n\n${WORDY}`),
    ]);
    expect(edit?.original.body).toBe(TIGHT);
  });

  it("keeps a draft's subject", () => {
    expect(
      findMessageEdit(TIGHT, [
        { from: "draft", subject: "Marketing Coordinator", text: WORDY },
      ])?.original,
    ).toEqual({ body: WORDY, subject: "Marketing Coordinator" });
  });

  it("shows no marks for a rewrite, keeping the original", () => {
    const edit = findMessageEdit(
      "Your Marketing Coordinator opening caught my eye. For the last four years working in marketing at a small nonprofit organization, I ran every social account and took Instagram past 9,500 followers, up from roughly 2,000 when I started there.",
      [draft(WORDY)],
    );
    expect(edit?.original.body).toBe(WORDY);
    expect(edit?.stretches).toBeUndefined();
  });

  it("finds nothing when the text comes back unchanged", () => {
    expect(findMessageEdit(WORDY, [draft(WORDY)])).toBeUndefined();
  });

  it("marks a replaced word with the word it replaced", () => {
    const edit = findMessageEdit(
      "Could we move the walkthrough to Friday at 10? Same room, same agenda.",
      [
        draft(
          "Could we move the walkthrough to Thursday at 10? Same room, same agenda.",
        ),
      ],
    );
    expect(edit?.stretches).toMatchInlineSnapshot(`
      [
        {
          "kind": "kept",
          "text": "Could we move the walkthrough to ",
        },
        {
          "kind": "new",
          "text": "Friday",
          "was": "Thursday",
        },
        {
          "kind": "kept",
          "text": " at 10? Same room, same agenda.",
        },
      ]
    `);
  });

  it("leaves a word standing between two cuts unmarked", () => {
    const edit = findMessageEdit(
      "I have spent four years in marketing at a small nonprofit.",
      [
        draft(
          "I have basically spent the last four years in marketing at a small nonprofit.",
        ),
      ],
    );
    expect(edit?.stretches).toEqual([
      {
        kind: "kept",
        text: "I have spent four years in marketing at a small nonprofit.",
      },
    ]);
  });
});
