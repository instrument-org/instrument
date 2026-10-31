import { describe, expect, it } from "vitest";

import { captionCandidates, srtToVtt } from "./media-captions";

describe("captionCandidates", () => {
  it.each([
    [
      "/Users/mac-user/Movies/talk.mp4",
      ["/Users/mac-user/Movies/talk.vtt", "/Users/mac-user/Movies/talk.srt"],
    ],
    [
      "/Users/mac-user/clip.final.webm",
      ["/Users/mac-user/clip.final.vtt", "/Users/mac-user/clip.final.srt"],
    ],
    [
      "/Users/mac-user/noext",
      ["/Users/mac-user/noext.vtt", "/Users/mac-user/noext.srt"],
    ],
    [
      String.raw`C:\Users\windows-user\talk.mp4`,
      [
        String.raw`C:\Users\windows-user\talk.vtt`,
        String.raw`C:\Users\windows-user\talk.srt`,
      ],
    ],
  ])("%s", (hostPath, expected) => {
    expect(captionCandidates(hostPath)).toEqual(expected);
  });
});

describe("srtToVtt", () => {
  it("adds the header and turns each timing's comma into a point", () => {
    const srt =
      "\uFEFF1\r\n00:00:01,000 --> 00:00:03,500\r\nHello, there.\r\n\r\n2\r\n00:01:02,250 --> 00:01:04,000\r\nTwo lines,\r\nstill one cue.\r\n";
    expect(srtToVtt(srt)).toMatchInlineSnapshot(`
      "WEBVTT

      1
      00:00:01.000 --> 00:00:03.500
      Hello, there.

      2
      00:01:02.250 --> 00:01:04.000
      Two lines,
      still one cue.
      "
    `);
  });

  it("leaves a comma in the words alone", () => {
    expect(
      srtToVtt("1\n00:00:00,000 --> 00:00:01,000\n1,000 people\n"),
    ).toContain("1,000 people");
  });
});
