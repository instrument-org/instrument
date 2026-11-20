import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
} from "react";

import { type ArrivingAsk } from "./settings-href";

/** What the page's address last asked of it once, counted, so the same ask again is a new one. */
export type SettingsAsk = ArrivingAsk & { n: number };

/** What the Settings, Memory or Skills page in this tab was last asked to open at. */
export const SettingsAskContext = createContext<null | SettingsAsk>(null);

export function useSettingsAsk(): null | SettingsAsk {
  return useContext(SettingsAskContext);
}

/**
 * Takes what an address asks of its page once (`ARRIVING_SEARCH`) as it
 * arrives, and drops it from the address, which `drop` replaces in place.
 * The ask stays the page's until the next one comes.
 */
export function useArrivingAsk(
  { log, memory, setting, usage }: ArrivingAsk,
  drop: () => void,
): null | SettingsAsk {
  const present: ArrivingAsk = {
    ...(log ? { log } : {}),
    ...(memory === undefined ? {} : { memory }),
    ...(setting === undefined ? {} : { setting }),
    ...(usage ? { usage } : {}),
  };
  const key =
    Object.keys(present).length === 0 ? undefined : JSON.stringify(present);
  const [taken, setTaken] = useState<{
    ask: null | SettingsAsk;
    key: string | undefined;
  }>({ ask: null, key: undefined });
  if (key !== taken.key) {
    setTaken({
      ask:
        key === undefined
          ? taken.ask
          : { ...present, n: (taken.ask?.n ?? 0) + 1 },
      key,
    });
  }
  const dropNow = useEffectEvent(drop);
  useEffect(() => {
    if (key !== undefined) {
      dropNow();
    }
  }, [key]);
  return taken.ask;
}
