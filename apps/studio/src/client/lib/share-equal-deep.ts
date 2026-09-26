/**
 * The next value with every part that equals the previous one's swapped for
 * the previous one's own object, as TanStack Query's structural sharing does,
 * except that a `Date` at the same instant counts as equal. The query's own
 * sharing takes any non-plain object as changed, so a record carrying a date
 * comes back as a new object on every update whether or not anything in it
 * moved, and whatever memoizes on it renders again.
 */
export function shareEqualDeep<T>(previous: unknown, next: T): T {
  return share(previous, next) as T;
}

function share(previous: unknown, next: unknown): unknown {
  if (previous === next) {
    return previous;
  }
  if (previous instanceof Date && next instanceof Date) {
    return previous.getTime() === next.getTime() ? previous : next;
  }
  if (Array.isArray(previous) && Array.isArray(next)) {
    let same = previous.length === next.length;
    const shared = next.map((item: unknown, index) => {
      const kept = share(previous[index], item);
      same &&= kept === previous[index];
      return kept;
    });
    return same ? previous : shared;
  }
  if (isPlainObject(previous) && isPlainObject(next)) {
    const previousKeys = Object.keys(previous);
    const nextKeys = Object.keys(next);
    let same = previousKeys.length === nextKeys.length;
    const shared: Record<string, unknown> = {};
    for (const key of nextKeys) {
      const kept = share(previous[key], next[key]);
      same &&= kept === previous[key] && Object.hasOwn(previous, key);
      shared[key] = kept;
    }
    return same ? previous : shared;
  }
  return next;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
