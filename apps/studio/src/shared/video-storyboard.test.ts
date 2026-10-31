import { describe, expect, it } from "vitest";

import { planStoryboard, storyboardVtt } from "./video-storyboard";

describe("planStoryboard", () => {
  it.each([
    ["too short", { duration: 10, height: 1080, width: 1920 }],
    [
      "no length",
      { duration: Number.POSITIVE_INFINITY, height: 1080, width: 1920 },
    ],
    ["no picture", { duration: 60, height: 0, width: 0 }],
  ])("gives none when %s", (_, video) => {
    expect(planStoryboard(video)).toBeNull();
  });

  it("takes a frame every 2 seconds of a short video", () => {
    expect(planStoryboard({ duration: 30, height: 1080, width: 1920 })).toEqual(
      {
        columns: 10,
        count: 15,
        frameHeight: 90,
        frameWidth: 160,
        interval: 2,
        rows: 2,
      },
    );
  });

  it("caps a long video at 100 frames, spread across it", () => {
    const plan = planStoryboard({
      duration: 3 * 3600,
      height: 1920,
      width: 1080,
    });
    expect(plan).toMatchObject({
      columns: 10,
      count: 100,
      interval: 108,
      rows: 10,
    });
    // A portrait video's frames are tall, and even.
    expect(plan?.frameHeight).toBe(284);
  });
});

describe("storyboardVtt", () => {
  it("names each frame's place on the sheet", () => {
    const vtt = storyboardVtt(
      {
        columns: 2,
        count: 3,
        frameHeight: 90,
        frameWidth: 160,
        interval: 2.5,
        modifiedAt: 1,
        rows: 2,
      },
      "sheet.jpg?version=1&storyboard",
    );
    expect(vtt).toMatchInlineSnapshot(`
      "WEBVTT

      00:00:00.000 --> 00:00:02.500
      sheet.jpg?version=1&storyboard#xywh=0,0,160,90

      00:00:02.500 --> 00:00:05.000
      sheet.jpg?version=1&storyboard#xywh=160,0,160,90

      00:00:05.000 --> 00:00:07.500
      sheet.jpg?version=1&storyboard#xywh=0,90,160,90
      "
    `);
  });
});
