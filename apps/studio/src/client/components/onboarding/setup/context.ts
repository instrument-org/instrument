import {
  type SetupAction,
  type SetupState,
} from "@/client/components/onboarding/setup/flow";
import { createContext, type Dispatch, useContext } from "react";

export type SetupContextValue = {
  dispatch: Dispatch<SetupAction>;
  /** Ends onboarding: records it done and hands the window back to the app. */
  finish: () => void;
  /** Whether this person used Instrument before this onboarding existed. */
  returning: boolean;
  state: SetupState;
};

export const SetupContext = createContext<SetupContextValue | null>(null);

/** The assistant's state and the ways a page moves it. */
export function useSetup(): SetupContextValue {
  const value = useContext(SetupContext);
  if (!value) {
    throw new Error("useSetup outside the setup assistant");
  }
  return value;
}
