import { plainTextOf } from "./plain-text";

export interface ParsedValue {
  /** How many decimals the number was written with. */
  decimals: number;
  prefix: string;
  /** Whether a scale letter (`k`, `M`, `B`) multiplied it. */
  scaled: boolean;
  suffix: string;
  value: number;
}

const VALUE =
  /^(?<approx>[~≈]\s*)?(?<lead>[$€£¥₹])?\s*(?<number>\d[\d,]*(?:\.\d+)?|\.\d+)\s*(?<scale>k|K|M|B|bn)?(?![a-zA-Z])\s*(?<unit>.*)$/u;

const SCALE: Record<string, number> = {
  B: 1e9,
  K: 1e3,
  M: 1e6,
  bn: 1e9,
  k: 1e3,
};

/**
 * A cell's number and the unit written around it: `$1,842`, `12%`,
 * `4.5 kWh`, `-3`, `(1,200)`, `$1.2M`. Undefined for anything else, a
 * number followed by more words among it.
 */
export function parseValue(written: string): ParsedValue | undefined {
  let text = plainTextOf(written).replace(/\s+/g, " ").trim();
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  const sign = /^([-−+])\s*/.exec(text) ?? /^[$€£¥₹]\s*([-−+])/.exec(text);
  if (sign) {
    negative ||= sign[1] !== "+";
    text = text.replace(/[-−+]\s*/, "");
  }
  const groups = VALUE.exec(text)?.groups;
  if (!groups?.number) {
    return undefined;
  }
  const unit = (groups.unit ?? "").trim();
  // A number followed by more words is a sentence, not a value.
  if (unit.length > 12 || /\d/.test(unit)) {
    return undefined;
  }
  const value =
    Number(groups.number.replaceAll(",", "")) *
    (groups.scale ? (SCALE[groups.scale] ?? 1) : 1);
  return {
    decimals: groups.number.split(".")[1]?.length ?? 0,
    prefix: groups.lead ?? "",
    scaled: groups.scale !== undefined,
    suffix: unit === "" ? "" : unit === "%" ? "%" : ` ${unit}`,
    value: negative ? -value : value,
  };
}
