import { KEPT_STATE_CHANNEL, type KeptFile } from "@/shared/kept-state";

type KeptChange = [file: KeptFile, key: string, value: unknown];
type ChangeListener = (file: KeptFile, key: string, value: unknown) => void;
type IpcListener = (event: unknown, ...change: KeptChange) => void;

/**
 * What other windows keep, as this window's renderer listens for it. Changes
 * are held from the moment this is called, right after the snapshot is read,
 * until the renderer's first listener comes: its code can take seconds to
 * load, a spare window's above all, and a change sent in between would leave
 * it working from a stale copy, such as a group's tabs without the one added
 * since. The first listener gets what was held, in order, then the rest.
 */
export function keptChangeFeed(ipc: {
  off: (channel: string, listener: IpcListener) => unknown;
  on: (channel: string, listener: IpcListener) => unknown;
}) {
  const held: KeptChange[] = [];
  const hold: IpcListener = (_event, ...change) => {
    held.push(change);
  };
  ipc.on(KEPT_STATE_CHANNEL.changed, hold);
  return (listener: ChangeListener) => {
    ipc.off(KEPT_STATE_CHANNEL.changed, hold);
    for (const change of held.splice(0)) {
      listener(...change);
    }
    const forward: IpcListener = (_event, ...change) => {
      listener(...change);
    };
    ipc.on(KEPT_STATE_CHANNEL.changed, forward);
    return () => {
      ipc.off(KEPT_STATE_CHANNEL.changed, forward);
    };
  };
}
