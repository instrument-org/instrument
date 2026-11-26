import { renderInBrowser } from "@/tests/render-browser";
import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { CardVersionContext } from "./card-version";
import { PictureCard, PictureRows } from "./picture-card";

/**
 * What a picture card lays out, which only a real layout engine answers: the
 * rows a set takes at its own shapes, where the controls go on hover, and what
 * the line under a picture keeps when it runs out of room.
 */

/** A picture of the given size, which the browser reads its shape from. */
const pictureOf = (width: number, height: number) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="teal"/></svg>`,
  )}`;

const fileOf = (name: string, width: number, height: number) => ({
  filename: name,
  hostPath: `/Users/casey/tasks/walk/${name}`,
  url: pictureOf(width, height),
});

/** A file channel that says every file is there and how big it is. */
function originAnswering(status: number, length = "2400000") {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(null, {
          headers: { "content-length": length },
          status,
        }),
      ),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const THREE = [
  fileOf("harbor.jpg", 300, 200),
  fileOf("desk.jpg", 200, 200),
  fileOf("tower.jpg", 140, 200),
];

async function drawRows(
  files: ReturnType<typeof fileOf>[],
  width: number,
  onOpen = vi.fn(),
) {
  const result = await renderInBrowser(
    <div style={{ width }}>
      <PictureRows order={files.map((file) => file.hostPath)}>
        {files.map((file, at) => (
          <CardVersionContext
            key={file.hostPath}
            value={at === 0 ? { number: 2 } : undefined}
          >
            <PictureCard file={file} onOpen={onOpen} />
          </CardVersionContext>
        ))}
      </PictureRows>
    </div>,
  );
  const cards = () => [
    ...result.container.querySelectorAll<HTMLElement>(
      "[data-slot='picture-card']",
    ),
  ];
  // Every picture has read its shape once each card is as wide as it.
  await expect
    .poll(() =>
      cards().every((card) => {
        const img = card.querySelector("img");
        return (
          img !== null &&
          img.naturalWidth > 0 &&
          Math.abs(
            img.getBoundingClientRect().width /
              img.getBoundingClientRect().height -
              img.naturalWidth / img.naturalHeight,
          ) < 0.02
        );
      }),
    )
    .toBe(true);
  return { ...result, cards };
}

test("keeps each picture at its own shape, in a row that shares one height", async () => {
  originAnswering(200);
  const { cards } = await drawRows(THREE, 736);

  expect(
    cards().map((card) => {
      const box = card.querySelector("img")?.getBoundingClientRect();
      return `${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)} at ${Math.round(box?.top ?? 0)}`;
    }),
  ).toMatchInlineSnapshot(`
    [
      "300x200 at 0",
      "200x200 at 0",
      "140x200 at 0",
    ]
  `);
});

test("names each picture and its size on the line under it", async () => {
  originAnswering(200);
  const { cards } = await drawRows(THREE, 736);

  await expect
    .poll(
      () => cards()[0]?.querySelector("[data-slot='file-size']")?.textContent,
    )
    .toBe(" · 2.4 MB");
  expect(cards()[0]?.textContent).toContain("harbor.jpg");
});

test("puts the controls on the line under the picture on hover, and leaves the version showing", async () => {
  originAnswering(200);
  const { cards } = await drawRows([fileOf("harbor.jpg", 600, 400)], 736);
  const [card] = cards();
  if (!card) {
    throw new Error("no card");
  }
  const actions = () =>
    card.querySelector<HTMLElement>("[data-slot='picture-actions']");
  const version = [...card.querySelectorAll("span")].find(
    (span) => span.textContent === "v2",
  );

  await userEvent.unhover(card);
  await expect
    .poll(() => Math.round(actions()?.getBoundingClientRect().width ?? -1))
    .toBe(0);

  await userEvent.hover(card);
  await expect
    .poll(() => Math.round(actions()?.getBoundingClientRect().width ?? -1))
    .toBeGreaterThan(0);

  const picture = card.querySelector("img")?.getBoundingClientRect();
  expect(actions()?.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    picture?.bottom ?? Number.POSITIVE_INFINITY,
  );
  expect(actions()?.textContent).toContain("Copy");
  expect(actions()?.textContent).toContain("Save as…");
  expect(version && getComputedStyle(version).opacity).toBe("1");
});

test("opens the picture from a press on it", async () => {
  originAnswering(200);
  const onOpen = vi.fn();
  const { cards } = await drawRows(
    [fileOf("harbor.jpg", 600, 400)],
    736,
    onOpen,
  );
  const picture = cards()[0]?.querySelector("img")?.getBoundingClientRect();
  if (!picture) {
    throw new Error("no picture");
  }

  // Where the picture is, which the press lands on whatever answers there.
  await userEvent.click(page.getByRole("button", { name: "Open harbor.jpg" }), {
    position: { x: picture.width / 2, y: picture.height / 2 },
  });

  expect(onOpen).toHaveBeenCalledTimes(1);
});

// A size cut short reads as a name that ran out of room, so the name gives way
// first, and the size is there whole or not at all.
test.each([
  { isShown: true, width: 200 },
  { isShown: false, width: 60 },
])(
  "says the size of a picture $width wide: $isShown",
  async ({ isShown, width }) => {
    originAnswering(200, "2140");
    const file = fileOf(
      "a-long-name-for-a-picture-of-the-harbor.jpg",
      width,
      100,
    );
    await renderInBrowser(
      <div style={{ width }}>
        <PictureCard file={file} onOpen={vi.fn()} />
      </div>,
    );

    const size = await vi.waitFor(() => {
      const element = document.querySelector("[data-slot=file-size]");
      if (!element?.parentElement) {
        throw new Error("no size");
      }
      return element;
    });
    const line = size.parentElement?.getBoundingClientRect();
    expect(size.textContent).toMatch(/^ · 2\.\d+ KB$/);
    expect(size.getBoundingClientRect().bottom <= (line?.bottom ?? 0)).toBe(
      isShown,
    );
  },
);

test("draws a picture that is gone as its outline and name, with nothing to press", async () => {
  originAnswering(404);
  const { container, getByText } = await renderInBrowser(
    <div style={{ width: 736 }}>
      <PictureRows order={[THREE[0]?.hostPath ?? ""]}>
        {THREE[0] && <PictureCard file={THREE[0]} onOpen={vi.fn()} />}
      </PictureRows>
    </div>,
  );

  await expect.element(getByText("· Missing")).toBeInTheDocument();
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("button")).toBeNull();
  expect(getByText("harbor.jpg")).toBeTruthy();
});
