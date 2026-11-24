import {
  KEPT_STATE_CHANNEL,
  type KeptFile,
  type TabsChanged,
} from "@/shared/kept-state";

type KeptChange = [file: KeptFile, key: string, value: unknown];

/**
 * What the main process tells a window on one channel, as its renderer
 * listens for it. Messages are held from the moment this is called, right
 * after the snapshot is read, until the renderer's first listener comes: its
 * code can take seconds to load, a spare window's above all, and a change
 * sent in between would leave it working from a stale copy, such as a
 * group's tabs without the one added since. The first listener gets what was
 * held, in order, then the rest.
 */
function heldFeed<T extends unknown[]>(ipc: Ipc, channel: string) {
  const held: T[] = [];
  // What main sends on a channel is that channel's own, which the one
  // listener type for every channel cannot say.
  const hold: IpcListener = (_event, ...told) => {
    held.push(told as T);
  };
  ipc.on(channel, hold);
  return (listener: (...told: T) => void) => {
    ipc.off(channel, hold);
    for (const told of held.splice(0)) {
      listener(...told);
    }
    const forward: IpcListener = (_event, ...told) => {
      listener(...(told as T));
    };
    ipc.on(channel, forward);
    return () => {
      ipc.off(channel, forward);
    };
  };
}

type IpcListener = (event: unknown, ...told: unknown[]) => void;

interface Ipc {
  off: (channel: string, listener: IpcListener) => unknown;
  on: (channel: string, listener: IpcListener) => unknown;
}

/** What other windows keep, a key at a time. */
export function keptChangeFeed(ipc: Ipc) {
  return heldFeed<KeptChange>(ipc, KEPT_STATE_CHANNEL.changed);
}

/** What each change to the tabs changed, whichever window asked for it. */
export function tabsChangedFeed(ipc: Ipc) {
  return heldFeed<[told: TabsChanged]>(ipc, KEPT_STATE_CHANNEL.tabsChanged);
}
