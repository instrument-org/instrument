/**
 * How long a menu's Paste waits for the paste it asked the window for.
 * Past it the folder it named is forgotten, so a Paste whose event never
 * came cannot send the next ⌘V somewhere the keyboard is not.
 */
const NAMED_FOR_MS = 2000;

/** The folder a menu's Paste named, for the paste it sets off to land in, once. */
export function createPasteTarget(now = () => Date.now()) {
  let named: null | { at: number; prefix: string } = null;
  return {
    name: (prefix: string) => {
      named = { at: now(), prefix };
    },
    /** The folder named, if a Paste named one just now; it is forgotten either way. */
    take: () => {
      const was = named;
      named = null;
      return was !== null && now() - was.at < NAMED_FOR_MS ? was.prefix : null;
    },
  };
}
