import { AppErrorCard } from "@/client/components/app-error-fallback";
import { ErrorCard } from "@/client/components/error-card";
import { type ReactNode } from "react";

import { DebugState } from "../-shell";
import { type NoticesStateId, noticesStatesOn } from "../-states/notices";

const simpleError = new Error("Something went wrong while loading your data.");

const errorWithCode = Object.assign(
  new Error("The request could not be authenticated."),
  { code: "UNAUTHORIZED" },
);

const errorWithCause = Object.assign(
  new Error("Failed to connect to the workspace server."),
  { cause: new Error("ECONNREFUSED 127.0.0.1:4000") },
);

const cards = {
  "error-with-cause": { card: <ErrorCard error={errorWithCause} sample /> },
  "error-with-code": { card: <ErrorCard error={errorWithCode} sample /> },
  "simple-error": { card: <ErrorCard error={simpleError} sample /> },
  "window-crash": {
    card: <AppErrorCard error={simpleError} sample />,
    note: "The whole app window shows this when it crashes, and reloading is the only way back.",
  },
} satisfies Record<
  NoticesStateId<"error-card">,
  { card: ReactNode; note?: string }
>;

export function ErrorCards() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-8">
      <p className="text-sm text-muted-foreground">
        A screen shows this card in its place when it fails to load. Every error
        carries its stack trace under a toggle.
      </p>
      {noticesStatesOn("error-card").map((state) => {
        const entry: { card: ReactNode; note?: string } = cards[state.id];
        return (
          <DebugState
            className="flex flex-col gap-3"
            id={state.id}
            key={state.id}
          >
            <div>
              <h2 className="text-sm font-medium">{state.label}</h2>
              {entry.note ? (
                <p className="text-xs text-muted-foreground">{entry.note}</p>
              ) : null}
            </div>
            {entry.card}
          </DebugState>
        );
      })}
    </div>
  );
}
