import { TaskIdSchema } from "@instrument-org/workspace/client";

/** The task a `task new` created, read off the command's output. */
export function createdTaskId(part: {
  input?: undefined | { command?: string };
  output?: undefined | { output?: string };
  state: string;
}): string | undefined {
  if (part.state !== "output-available") {
    return;
  }
  const command = part.input?.command ?? "";
  if (!/(?:^|[\n;&|])\s*task new\b/.test(command)) {
    return;
  }
  const created = /^Created (\S+)/m.exec(part.output?.output ?? "");
  const id = created?.[1];
  return id && TaskIdSchema.safeParse(id).success ? id : undefined;
}
