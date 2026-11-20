/**
 * How long after one file the system hands over the next still joins it.
 * The Finder hands over a selection opened or dropped together one file at a
 * time, all at once.
 */
const QUIET_MS = 100;

/**
 * The longest a hand-over waits after its first file, however many keep
 * coming, so a long selection opens without a wait the person notices.
 */
const LONGEST_MS = 300;

/**
 * Gathers files the system hands over one at a time into the hand-overs they
 * were: each file waits for the next for `QUIET_MS`, starting over as each
 * one comes, and `open` takes them all together once none has come for that
 * long, or `LONGEST_MS` after the first, whichever is sooner.
 */
export function createFilesTogether(
  open: (hostPaths: string[]) => void,
  { longestMs = LONGEST_MS, quietMs = QUIET_MS } = {},
) {
  let arriving: string[] = [];
  let firstAt = 0;
  let timer: NodeJS.Timeout | undefined;

  const handOver = () => {
    const paths = arriving;
    arriving = [];
    timer = undefined;
    open(paths);
  };

  return (hostPath: string) => {
    const now = Date.now();
    if (arriving.length === 0) {
      firstAt = now;
    }
    arriving.push(hostPath);
    clearTimeout(timer);
    timer = setTimeout(
      handOver,
      Math.max(0, Math.min(quietMs, firstAt + longestMs - now)),
    );
  };
}
