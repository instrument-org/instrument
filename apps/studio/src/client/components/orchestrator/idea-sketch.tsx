import { type ReactNode } from "react";

/**
 * The small abstract page on an idea's tile, drawn from the idea's `sketch`.
 *
 * One mark per idea, as large as the page will hold: a tile carries one idea,
 * so a sketch draws one thing, since a stack of miniature rows comes out as
 * the same grey document for every idea and tells them apart from nothing.
 * The same drawing the website's Discover section uses, so an idea looks the
 * same on the site and in the app.
 *
 * The vocabulary is the registry's (see the skills repo's AGENTS.md, Ideas).
 * An idea naming no mark this file knows gets a plain page rather than nothing.
 */
const PAGE_W = 120;
const PAGE_H = 160;
const PAD = 12;
/** The drawable width, and the band a mark occupies under the title bar. */
const W = PAGE_W - PAD * 2;
const TOP = 32;
const BOT = 130;
const H = BOT - TOP;
const MID = PAD + W / 2;

// The page is paper and stays white in both themes, so its inks are the gray
// ramp's fixed values rather than the theme's foreground.
const TEXT = "var(--color-gray-300)";
const TEXT_DARK = "var(--color-gray-500)";
const BOX = "var(--color-gray-100)";
const EDGE = "var(--color-gray-200)";
const BRAND = "var(--color-brand-600)";
const BRAND_SOFT = "var(--color-brand-100)";

const box = (
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fill = "white",
  stroke?: string,
  rx = 3,
) => (
  <rect
    fill={fill}
    height={h}
    key={key}
    rx={rx}
    stroke={stroke}
    strokeWidth={stroke ? 1.5 : undefined}
    width={w}
    x={x}
    y={y}
  />
);

const bar = (
  key: string,
  x: number,
  y: number,
  w: number,
  fill = TEXT,
  h = 4,
) => box(key, x, y, w, h, fill, undefined, h / 2);

const tick = (key: string, x: number, y: number, scale = 1) => (
  <path
    d={`M${x} ${y} l${3 * scale} ${3.5 * scale} l${6 * scale} ${-7 * scale}`}
    fill="none"
    key={key}
    stroke={BRAND}
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2.5 * scale}
  />
);

const cross = (key: string, x: number, y: number, r: number) => (
  <g key={key} stroke={TEXT_DARK} strokeLinecap="round" strokeWidth={2.5}>
    <path d={`M${x - r} ${y - r} l${r * 2} ${r * 2}`} />
    <path d={`M${x + r} ${y - r} l${-r * 2} ${r * 2}`} />
  </g>
);

const arrowDown = (key: string, x: number, y: number, len: number) => (
  <g key={key} stroke={BRAND} strokeLinecap="round" strokeWidth={2}>
    <path d={`M${x} ${y} v${len}`} />
    <path d={`M${x - 3.5} ${y + len - 4} l3.5 4 l3.5 -4`} fill="none" />
  </g>
);

/** Evenly spaced rows across the mark's band. */
const rows = (count: number, height: number) => {
  const gap = (H - count * height) / (count - 1);
  return Array.from({ length: count }, (_, i) => TOP + i * (height + gap));
};

/** How full each bar of the `weights` mark is, longest first. */
const WEIGHTS = [0.9, 0.55, 0.75, 0.35];

const MARKS: Record<string, () => ReactNode> = {
  /** Whiteboard: things placed on a plane, with no order to read them in. */
  board: () => {
    const notes: [number, number, number, string][] = [
      [2, 4, -6, BRAND_SOFT],
      [38, 0, 4, BOX],
      [66, 20, -3, BOX],
      [10, 38, 5, BOX],
      [44, 54, -4, BRAND_SOFT],
      [4, 72, 3, BOX],
    ];
    return notes.map(([dx, dy, rot, fill], i) => (
      <rect
        fill={fill}
        height={26}
        key={i}
        rx={3}
        stroke={EDGE}
        transform={`rotate(${rot} ${PAD + dx + 13} ${TOP + dy + 13})`}
        width={26}
        x={PAD + dx}
        y={TOP + dy}
      />
    ));
  },

  /** Tool: something goes in, one answer comes out. */
  compute: () => (
    <>
      {box("in", PAD, TOP, W, 22, "white", EDGE)}
      {bar("in-v", PAD + 8, TOP + 9, 40, TEXT)}
      {arrowDown("a", MID, TOP + 26, 16)}
      {box("out", PAD, TOP + 50, W, 44, BRAND, undefined, 4)}
      {bar("out-v", PAD + 14, TOP + 66, 68, "white", 12)}
    </>
  ),

  /** Itinerary: a day at a time, each with its own few things. */
  days: () =>
    rows(3, 30).map((y, i) => (
      <g key={i}>
        {box(`d${i}`, PAD, y, 20, 30, BRAND_SOFT)}
        {bar(`d${i}a`, PAD + 26, y + 4, 60, TEXT_DARK, 5)}
        {bar(`d${i}b`, PAD + 26, y + 14, 48, TEXT)}
        {bar(`d${i}c`, PAD + 26, y + 22, 36, TEXT)}
      </g>
    )),

  /** Playground: one thing on a stage, and the dials for it beside it. */
  dials: () => (
    <>
      {box("stage", PAD, TOP, 52, H, "white", EDGE, 4)}
      {box("thing", PAD + 12, TOP + 31, 28, 36, BRAND, undefined, 6)}
      {[0.7, 0.3, 0.55].map((at, i) => {
        const y = TOP + 14 + i * 33;
        return (
          <g key={i}>
            {box(`t${i}`, PAD + 60, y, 36, 5, BOX, undefined, 2.5)}
            <circle cx={PAD + 60 + 36 * at} cy={y + 2.5} fill={BRAND} r={5.5} />
          </g>
        );
      })}
    </>
  ),

  /** Explainer: this, then this, then that. */
  flow: () => (
    <>
      {box("a", PAD + 12, TOP, 72, 22, "white", EDGE)}
      {bar("av", PAD + 22, TOP + 9, 52, TEXT)}
      {arrowDown("x", MID, TOP + 26, 11)}
      {box("b", PAD + 12, TOP + 38, 72, 22, BRAND_SOFT)}
      {bar("bv", PAD + 22, TOP + 47, 52, BRAND)}
      {arrowDown("y", MID, TOP + 64, 11)}
      {box("c", PAD + 12, TOP + 76, 72, 22, "white", EDGE)}
      {bar("cv", PAD + 22, TOP + 85, 52, TEXT)}
    </>
  ),

  /** Wireframe: the same screen several times, each with a caption. */
  frames: () =>
    [0, 1, 2, 3].map((i) => {
      const x = PAD + (i % 2) * 52;
      const y = TOP + Math.floor(i / 2) * 52;
      return (
        <g key={i}>
          {box(`f${i}`, x, y, 44, 36, "white", EDGE)}
          {bar(`f${i}t`, x + 5, y + 6, 22, EDGE, 4)}
          {box(`f${i}b`, x + 5, y + 15, 34, 15, BOX, undefined, 2)}
          {bar(`f${i}c`, x, y + 41, 36, TEXT, 3)}
        </g>
      );
    }),

  /** Should I…?: it comes out one way or the other. */
  fork: () => (
    <>
      {box("y", PAD, TOP + 8, 44, 44, BRAND, undefined, 6)}
      <path
        d={`M${PAD + 12} ${TOP + 30} l7 8 l14 -17`}
        fill="none"
        key="yt"
        stroke="white"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={4}
      />
      {box("n", PAD + 52, TOP + 8, 44, 44, "white", EDGE, 6)}
      {cross("nx", PAD + 74, TOP + 30, 9)}
      {bar("l1", PAD + 8, TOP + 70, 80, TEXT)}
      {bar("l2", PAD + 8, TOP + 80, 58, TEXT)}
    </>
  ),

  /** Scorecard: one thing, rated. */
  grade: () => {
    const r = 28;
    const c = 2 * Math.PI * r;
    return (
      <>
        <circle
          cx={MID}
          cy={TOP + 34}
          fill="none"
          key="track"
          r={r}
          stroke={EDGE}
          strokeWidth={11}
        />
        <circle
          cx={MID}
          cy={TOP + 34}
          fill="none"
          key="fill"
          r={r}
          stroke={BRAND}
          strokeDasharray={`${c * 0.72} ${c}`}
          strokeLinecap="round"
          strokeWidth={11}
          transform={`rotate(-90 ${MID} ${TOP + 34})`}
        />
        {bar("l1", PAD + 18, TOP + 76, 60, TEXT_DARK, 5)}
        {bar("l2", PAD + 28, TOP + 87, 40, TEXT)}
      </>
    );
  },

  /** Comparison matrix: options across, specs down. */
  grid: () => {
    const cols = 4;
    const gap = 3;
    const cw = (W - gap * (cols - 1)) / cols;
    const ch = (H - gap * 3) / 4;
    return Array.from({ length: 16 }, (_, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const head = row === 0 || col === 0;
      return box(
        `c${i}`,
        PAD + col * (cw + gap),
        TOP + row * (ch + gap),
        cw,
        ch,
        head ? EDGE : col === 2 ? BRAND_SOFT : BOX,
        undefined,
        2,
      );
    });
  },

  /** Briefing memo: a formal page, dense, with a line drawn across it. */
  memo: () => (
    <>
      {box("band", PAD, TOP, W, 13, TEXT_DARK, undefined, 2)}
      {[0, 1, 2, 3, 4].map((i) =>
        bar(`p${i}`, PAD, TOP + 22 + i * 9, i === 4 ? 62 : W, TEXT),
      )}
      {box("rule", PAD, TOP + 68, W, 2, EDGE, undefined, 1)}
      {[0, 1, 2].map((i) =>
        bar(`q${i}`, PAD, TOP + 78 + i * 9, i === 2 ? 48 : W, TEXT),
      )}
    </>
  ),

  /** Storyboard: a few moments in a row, a person in each. */
  panels: () =>
    rows(3, 28).map((y, i) => {
      const beat = i === 1;
      const ink = beat ? BRAND : TEXT_DARK;
      return (
        <g key={i}>
          {box(
            `p${i}`,
            PAD,
            y,
            W,
            28,
            beat ? BRAND_SOFT : "white",
            beat ? undefined : EDGE,
          )}
          <circle cx={PAD + 14} cy={y + 10} fill={ink} key={`h${i}`} r={4.5} />
          <path
            d={`M${PAD + 7} ${y + 25} a7 7 0 0 1 14 0 z`}
            fill={ink}
            key={`s${i}`}
          />
          {bar(`c${i}`, PAD + 30, y + 12, beat ? 52 : 40, beat ? BRAND : TEXT)}
        </g>
      );
    }),

  /** Map: numbered pins dropped on a plain ground. */
  pins: () => (
    <>
      {box("ground", PAD, TOP, W, H, BOX, undefined, 4)}
      <g key="streets" stroke={EDGE} strokeLinecap="round" strokeWidth={2.5}>
        <path d={`M${PAD + 4} ${TOP + 28} L${PAD + W - 4} ${TOP + 64}`} />
        <path d={`M${PAD + 30} ${TOP + 4} L${PAD + 62} ${TOP + H - 4}`} />
      </g>
      {(
        [
          [24, 24],
          [68, 40],
          [40, 76],
        ] satisfies [number, number][]
      ).map(([x, y], i) => (
        <g key={i}>
          <circle
            cx={PAD + x}
            cy={TOP + y}
            fill={BRAND}
            r={9}
            stroke="white"
            strokeWidth={2}
          />
          {bar(`n${i}`, PAD + x - 3, TOP + y - 3, 6, "white", 6)}
        </g>
      ))}
    </>
  ),

  /** FAQ: the same question shape, over and over. */
  qa: () =>
    rows(3, 30).map((y, i) => (
      <g key={i}>
        {box(`q${i}`, PAD, y, W, 30, BOX, undefined, 4)}
        {bar(`q${i}a`, PAD + 8, y + 8, 54, TEXT_DARK, 5)}
        {bar(`q${i}b`, PAD + 8, y + 19, 38, TEXT, 3)}
        <path
          d={`M${PAD + W - 16} ${y + 11} l5 5 l-5 5`}
          fill="none"
          key={`c${i}`}
          stroke={TEXT}
          strokeLinecap="round"
          strokeWidth={2}
        />
      </g>
    )),

  /** Case study: somebody's words, and the number they got. */
  quote: () => (
    <>
      {box("rule", PAD, TOP, 5, 44, BRAND, undefined, 2.5)}
      {[0, 1, 2, 3].map((i) =>
        bar(`l${i}`, PAD + 14, TOP + 2 + i * 11, i === 3 ? 44 : 82, TEXT),
      )}
      {box("badge", PAD, TOP + 54, W, 40, BRAND_SOFT, undefined, 5)}
      {bar("bv", PAD + 16, TOP + 65, 64, BRAND, 12)}
      {bar("bl", PAD + 16, TOP + 82, 42, TEXT, 3)}
    </>
  ),

  /** Recommendation guide: several considered, one picked. */
  rank: () =>
    rows(3, 30).map((y, i) => (
      <g key={i}>
        {box(
          `r${i}`,
          PAD,
          y,
          W,
          30,
          i === 0 ? BRAND_SOFT : "white",
          i === 0 ? undefined : EDGE,
          4,
        )}
        <circle
          cx={PAD + 17}
          cy={y + 15}
          fill={i === 0 ? BRAND : EDGE}
          key={`d${i}`}
          r={9}
        />
        {bar(
          `r${i}a`,
          PAD + 32,
          y + 8,
          i === 0 ? 50 : 42,
          i === 0 ? BRAND : TEXT_DARK,
          5,
        )}
        {bar(`r${i}b`, PAD + 32, y + 19, 32, TEXT, 3)}
      </g>
    )),

  /** One-pager: the whole argument on one sheet. */
  sheet: () => (
    <>
      {bar("h", PAD, TOP, 74, TEXT_DARK, 10)}
      {bar("s", PAD, TOP + 14, 50, TEXT, 4)}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          {box(`c${i}`, PAD + i * 33, TOP + 26, 30, 34, BOX, undefined, 3)}
          {bar(`c${i}a`, PAD + i * 33 + 5, TOP + 32, 20, TEXT_DARK, 4)}
          {bar(`c${i}b`, PAD + i * 33 + 5, TOP + 41, 14, TEXT, 3)}
        </g>
      ))}
      {box("foot", PAD, TOP + 68, W, 26, BRAND, undefined, 4)}
      {bar("fv", PAD + 16, TOP + 77, 64, "white", 8)}
    </>
  ),

  /** TLDR brief: the point, then three lines, then nothing. */
  short: () => (
    <>
      {bar("lead", PAD, TOP, 84, TEXT_DARK, 12)}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <circle
            cx={PAD + 4}
            cy={TOP + 26 + i * 16}
            fill={BRAND}
            key={`d${i}`}
            r={4}
          />
          {bar(
            `b${i}`,
            PAD + 14,
            TOP + 23 + i * 16,
            i === 2 ? 46 : 74,
            TEXT,
            5,
          )}
        </g>
      ))}
    </>
  ),

  /** Pros and cons: the same weight either side of a line. */
  split: () => (
    <>
      {box("rule", MID - 1, TOP, 2, H, EDGE, undefined, 1)}
      {[0, 1, 2].map((i) => {
        const y = TOP + 14 + i * 30;
        return (
          <g key={i}>
            <path
              d={`M${PAD + 4} ${y} h11 M${PAD + 9.5} ${y - 5.5} v11`}
              key={`p${i}`}
              stroke={BRAND}
              strokeLinecap="round"
              strokeWidth={3}
            />
            {bar(`pl${i}`, PAD + 21, y - 2.5, 22, TEXT, 5)}
            <path
              d={`M${MID + 6} ${y} h11`}
              key={`m${i}`}
              stroke={TEXT_DARK}
              strokeLinecap="round"
              strokeWidth={3}
            />
            {bar(`ml${i}`, MID + 23, y - 2.5, 22, TEXT, 5)}
          </g>
        );
      })}
    </>
  ),

  /** Timeline: when things happened, in order. */
  spine: () => (
    <>
      {box("line", PAD + 8, TOP, 2.5, H, EDGE, undefined, 1.25)}
      {[0, 1, 2, 3].map((i) => {
        const y = TOP + 10 + i * 26;
        return (
          <g key={i}>
            <circle
              cx={PAD + 9}
              cy={y}
              fill={i === 1 ? BRAND : "white"}
              key={`d${i}`}
              r={7}
              stroke={i === 1 ? BRAND : EDGE}
              strokeWidth={2.5}
            />
            {bar(`a${i}`, PAD + 24, y - 6, 52, TEXT_DARK, 5)}
            {bar(`b${i}`, PAD + 24, y + 4, 34, TEXT, 3)}
          </g>
        );
      })}
    </>
  ),

  /** Dashboard: the figures for the period, and one picture. */
  stats: () => (
    <>
      {[0, 1, 2, 3].map((i) => {
        const x = PAD + (i % 2) * 50;
        const y = TOP + Math.floor(i / 2) * 31;
        return (
          <g key={i}>
            {box(`s${i}`, x, y, 46, 28, BOX, undefined, 3)}
            {bar(`s${i}a`, x + 6, y + 6, 18, TEXT, 3)}
            {bar(`s${i}b`, x + 6, y + 13, 30, i === 0 ? BRAND : TEXT_DARK, 9)}
          </g>
        );
      })}
      {[0.5, 0.8, 0.35, 1, 0.6].map((v, i) =>
        box(
          `c${i}`,
          PAD + i * 20,
          TOP + 98 - 32 * v,
          14,
          32 * v,
          i === 3 ? BRAND : EDGE,
          undefined,
          2,
        ),
      )}
    </>
  ),

  /** How-to: numbered steps, in the order you do them. */
  steps: () =>
    rows(3, 30).map((y, i) => (
      <g key={i}>
        <circle
          cx={PAD + 13}
          cy={y + 15}
          fill="white"
          key={`n${i}`}
          r={12}
          stroke={BRAND}
          strokeWidth={2.5}
        />
        {bar(`n${i}v`, PAD + 9, y + 12, 8, BRAND, 6)}
        {bar(`a${i}`, PAD + 32, y + 7, 54, TEXT_DARK, 5)}
        {bar(`b${i}`, PAD + 32, y + 18, 40, TEXT)}
      </g>
    )),

  /** Data explorer: more rows than anyone will read, and a way in. */
  table: () => (
    <>
      {box("bar", PAD, TOP, W, 17, "white", EDGE, 8.5)}
      <circle
        cx={PAD + 13}
        cy={TOP + 8.5}
        fill="none"
        key="lens"
        r={4.5}
        stroke={TEXT}
        strokeWidth={2}
      />
      {bar("q", PAD + 24, TOP + 6.5, 40, EDGE, 4)}
      {Array.from({ length: 7 }, (_, i) =>
        box(
          `r${i}`,
          PAD,
          TOP + 26 + i * 10,
          W,
          7,
          i === 0 ? EDGE : BOX,
          undefined,
          1.5,
        ),
      )}
      {box("col", PAD + 52, TOP + 26, 20, 61, BRAND_SOFT, undefined, 1.5)}
    </>
  ),

  /** Checklist: things to tick off. */
  ticks: () =>
    rows(3, 30).map((y, i) => (
      <g key={i}>
        {box(`b${i}`, PAD, y + 4, 22, 22, "white", i < 2 ? BRAND : EDGE, 4)}
        {i < 2 ? tick(`t${i}`, PAD + 6, y + 15, 1.4) : null}
        {bar(`a${i}`, PAD + 32, y + 8, 54, TEXT_DARK, 5)}
        {bar(`c${i}`, PAD + 32, y + 19, 38, TEXT)}
      </g>
    )),

  /** Recommendation with criteria: everything scored on the same scale. */
  weights: () =>
    rows(4, 20).map((y, i) => (
      <g key={i}>
        {bar(`l${i}`, PAD, y + 6, 22, TEXT_DARK, 6)}
        {box(`t${i}`, PAD + 28, y + 5, 68, 8, BOX, undefined, 4)}
        {box(
          `f${i}`,
          PAD + 28,
          y + 5,
          68 * (WEIGHTS[i] ?? 0.5),
          8,
          i === 0 ? BRAND : BRAND_SOFT,
          undefined,
          4,
        )}
      </g>
    )),
};

/** Anything with no mark of its own still looks like a page. */
const plain = () => (
  <>
    {[0, 1, 2, 3, 4].map((i) =>
      bar(`p${i}`, PAD, TOP + i * 15, i === 4 ? 56 : W, TEXT, 6),
    )}
  </>
);

export function IdeaSketch({
  className,
  rows: tokens,
}: {
  className?: string;
  rows: string[];
}) {
  const mark = tokens.map((token) => MARKS[token]).find(Boolean);

  return (
    <svg
      aria-hidden
      className={className}
      viewBox={`0 0 ${PAGE_W} ${PAGE_H}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect fill="white" height={PAGE_H} rx={6} width={PAGE_W} />
      <rect
        fill={TEXT_DARK}
        height={7}
        rx={3.5}
        width={48}
        x={PAD}
        y={PAD + 2}
      />
      {mark ? mark() : plain()}
    </svg>
  );
}
