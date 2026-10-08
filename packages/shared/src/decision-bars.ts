/**
 * How sure the decision model has to be, for each model that may answer.
 * Each scores on its own scale, and which one answers depends on the
 * provider and on the request: the Instrument API sends a request too long
 * for one call to Clef and a shorter one to Clef-flash, and an OpenRouter key
 * reaches Jev. So a caller reads its bar off the `model` a response names
 * rather than fixing one. `pnpm eval:decision` measures where each belongs.
 */
export interface DecisionBars {
  clef: number;
  clefFlash: number;
  /** Any other model, which today is Jev. */
  other: number;
}

export function decisionBar(
  model: string | undefined,
  bars: DecisionBars,
): number {
  // Workers AI names the model bare ("clef-flash"), OpenRouter with its
  // vendor and a dated suffix ("cloudflare/clef-flash-20260929").
  const name = model?.split("/").at(-1) ?? "";
  if (name.startsWith("clef-flash")) {
    return bars.clefFlash;
  }
  return name.startsWith("clef") ? bars.clef : bars.other;
}
