/**
 * Regions: how every direct edit is written and undone. A region is a
 * stretch of the file before and after the change, widened with unchanged
 * context on both sides so it can be found again once other edits (the
 * agent's included) have moved it.
 */
import { findNearest, type Splice } from "./source";
import { type RawRegion } from "./structure";

/** A region as it was placed, with where its text starts once every region is applied. */
export interface AppliedRegion extends Region {
  atAfter: number;
}

/** The text with every region applied, and where each landed. */
export interface Placed {
  applied: AppliedRegion[];
  text: string;
}

/** A change with the unchanged text around it: `pre` and `post` characters of `before` and `after` are context. */
export interface Region extends RawRegion {
  post: number;
  pre: number;
}

/** Apply regions to `text` (exact offsets if they still match, else nearest copy). */
export function place(text: string, regions: Region[]): null | Placed {
  const sorted = [...regions].sort((a, b) => b.at - a.at);
  let out = text;
  const hits: Region[] = [];
  for (const r of sorted) {
    const hit = locate(out, r);
    if (!hit) {
      return null;
    }
    out =
      out.slice(0, hit.at) + hit.after + out.slice(hit.at + hit.before.length);
    const exact = hit.before === r.before;
    hits.push({
      after: hit.after,
      at: hit.at,
      before: hit.before,
      post: exact ? r.post : 0,
      pre: exact ? r.pre : 0,
    });
  }
  hits.sort((a, b) => a.at - b.at);
  let shiftBy = 0;
  const applied = hits.map((r) => {
    const atAfter = r.at + shiftBy;
    shiftBy += r.after.length - r.before.length;
    return { ...r, atAfter };
  });
  return { applied, text: out };
}

/** A region covering [a, b) of `src` with `splices` applied inside it, plus context. */
export function regionOf(src: string, a: number, b: number, splices: Splice[]) {
  let after = src.slice(a, b);
  for (const sp of [...splices].sort((x, y) => y.start - x.start)) {
    after = after.slice(0, sp.start - a) + sp.text + after.slice(sp.end - a);
  }
  return withContext(src, { after, at: a, before: src.slice(a, b) });
}

/** Widen a region with unchanged text on both sides so it can be found again after other edits. */
export function withContext(src: string, r: RawRegion, k = 48): Region {
  const s = Math.max(0, r.at - k);
  const e = Math.min(src.length, r.at + r.before.length + k);
  const pre = src.slice(s, r.at);
  const post = src.slice(r.at + r.before.length, e);
  return {
    after: pre + r.after + post,
    at: s,
    before: pre + r.before + post,
    post: post.length,
    pre: pre.length,
  };
}

/** Where a region's text sits in `text`: exact offset, else nearest copy with context, else nearest copy of the changed core alone. */
function locate(text: string, r: Region): null | RawRegion {
  if (text.slice(r.at, r.at + r.before.length) === r.before) {
    return { after: r.after, at: r.at, before: r.before };
  }
  const at = findNearest(text, r.before, r.at);
  if (at >= 0) {
    return { after: r.after, at, before: r.before };
  }
  // A neighbor changed (the agent wrote next to this edit): drop the context.
  const before = r.before.slice(r.pre, r.before.length - r.post);
  const after = r.after.slice(r.pre, r.after.length - r.post);
  if (!before) {
    return null;
  }
  const core = findNearest(text, before, r.at + r.pre);
  return core < 0 ? null : { after, at: core, before };
}
