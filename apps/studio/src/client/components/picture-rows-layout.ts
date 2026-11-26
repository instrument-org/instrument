/**
 * Where each picture in a set goes: rows that share a height, each picture at
 * its own width, justified to the column.
 *
 * A row fills until the next picture would pull it further from the set
 * height than stopping short would, then scales to the column. A picture wider
 * than `OWN_ROW_RATIO` takes a row of its own at the column's width. A last
 * row that ends short keeps the set height. A picture alone is the reply's
 * subject, drawn as large as `LONE_MAX_HEIGHT` and the column allow, and never
 * past its own size.
 */

/** A picture's shape: its width over its height. */
export interface PictureShape {
  height: number;
  width: number;
}

/** Where one picture goes, in pixels; `end` is the room left after the last of a short row. */
export interface PictureSlot {
  end: number;
  height: number;
  width: number;
}

/** The space between two pictures, across and down. */
export const PICTURE_GAP = 12;

/** The shape a picture is drawn at before its own is known, and a missing one always. */
export const PLACEHOLDER_RATIO = 1.5;

const OWN_ROW_RATIO = 2.2;
const LONE_MAX_HEIGHT = 400;
/** Below this column width the set height drops, so a narrow chat still gets two to a row. */
const NARROW_COLUMN = 560;

/** The height a row aims for in a column this wide. */
function setHeightFor(columnWidth: number) {
  return columnWidth < NARROW_COLUMN ? 160 : 200;
}

export function layoutPictureRows(
  pictures: readonly { ratio: number; size?: PictureShape }[],
  columnWidth: number,
): PictureSlot[] {
  const W = Math.max(0, Math.floor(columnWidth));
  if (W === 0 || pictures.length === 0) {
    return pictures.map(() => ({ end: 0, height: 0, width: 0 }));
  }

  if (pictures.length === 1) {
    const [only] = pictures;
    const { ratio, size } = only ?? { ratio: PLACEHOLDER_RATIO };
    const height = Math.min(
      LONE_MAX_HEIGHT,
      W / ratio,
      size?.height ?? Number.POSITIVE_INFINITY,
    );
    const width = Math.min(W, Math.round(height * ratio));
    return [{ end: W - width, height: Math.round(height), width }];
  }

  const H = setHeightFor(W);
  const g = PICTURE_GAP;
  const sum = (row: number[]) =>
    row.reduce((total, index) => total + (pictures[index]?.ratio ?? 0), 0);
  const fit = (row: number[]) => (W - g * (row.length - 1)) / sum(row);

  const rows: { fills: boolean; height: number; row: number[] }[] = [];
  const closeShort = (row: number[]) => {
    if (row.length === 0) {
      return;
    }
    const height = Math.min(H, fit(row));
    rows.push({ fills: height === fit(row), height, row });
  };

  let current: number[] = [];
  pictures.forEach(({ ratio }, index) => {
    if (ratio > OWN_ROW_RATIO) {
      closeShort(current);
      current = [];
      rows.push({ fills: true, height: W / ratio, row: [index] });
      return;
    }
    const next = [...current, index];
    if (sum(next) * H + g * (next.length - 1) < W) {
      current = next;
      return;
    }
    if (
      current.length > 0 &&
      Math.abs(fit(current) - H) < Math.abs(fit(next) - H)
    ) {
      rows.push({ fills: true, height: fit(current), row: current });
      current = [index];
    } else {
      rows.push({ fills: true, height: fit(next), row: next });
      current = [];
    }
  });
  closeShort(current);

  const slots: PictureSlot[] = pictures.map(() => ({
    end: 0,
    height: 0,
    width: 0,
  }));
  for (const { fills, height, row } of rows) {
    const widths = row.map((index) =>
      Math.floor(height * (pictures[index]?.ratio ?? 1)),
    );
    const used =
      widths.reduce((total, width) => total + width, 0) + g * (row.length - 1);
    // A full row's rounding goes to its last picture, so its right edge is the
    // column's; a short one keeps its widths and says what room is left.
    const left = Math.max(0, W - used);
    row.forEach((index, at) => {
      const isLast = at === row.length - 1;
      const width = (widths[at] ?? 0) + (isLast && fills ? left : 0);
      slots[index] = {
        end: isLast && !fills ? left : 0,
        height: Math.round(height),
        width,
      };
    });
  }
  return slots;
}
