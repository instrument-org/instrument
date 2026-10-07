/**
 * How much of the Claude plan is used, by window, as the CLI reports it: the
 * account's whole use, including outside this app.
 */
export interface ClaudePlanUsage {
  windows: {
    label: string;
    /** When the window starts over, as an ISO date. */
    resetsAt: string | undefined;
    /** Percent of the window used, 0 to 100. */
    used: number;
  }[];
}

/**
 * Read the plan's usage from a short-lived CLI process. Loaded on demand, so
 * nothing that imports the gateway's index pulls in the Agent SDK.
 */
export async function fetchClaudePlanUsage({
  configDir,
  executablePath,
}: {
  configDir: string | undefined;
  executablePath: string;
}): Promise<ClaudePlanUsage> {
  const { ClaudePlanSession } = await import("./session");
  const session = new ClaudePlanSession(
    "usage",
    {
      builtInTools: [],
      configDir,
      effort: undefined,
      executablePath,
      modelId: "default",
      systemPrompt: "",
      tools: [],
    },
    () => {},
  );
  try {
    const { rate_limits: limits } = await session.usage();
    const windows: ClaudePlanUsage["windows"] = [];
    const add = (
      label: string,
      window:
        | { resets_at: string | null; utilization: number | null }
        | null
        | undefined,
    ) => {
      if (window?.utilization !== null && window?.utilization !== undefined) {
        windows.push({
          label,
          resetsAt: window.resets_at ?? undefined,
          used: window.utilization,
        });
      }
    };
    add("5-hour", limits?.five_hour);
    add("Weekly", limits?.seven_day);
    for (const scoped of limits?.model_scoped ?? []) {
      add(`${scoped.display_name} weekly`, scoped);
    }
    return { windows };
  } finally {
    session.close();
  }
}
