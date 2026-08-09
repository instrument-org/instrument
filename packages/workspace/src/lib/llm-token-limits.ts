export const DEFAULT_MAX_OUTPUT_TOKENS = 32_000;
// A reasoning model spends this budget on thinking before it writes the first
// character of the title, and a turn that hits the ceiling mid-thought returns
// no text at all -- so the number has to cover the reasoning, not the eight
// words that follow it. It is a ceiling, and a model that does not reason
// still stops after a line.
export const TASK_NAME_MAX_OUTPUT_TOKENS = 8192;
