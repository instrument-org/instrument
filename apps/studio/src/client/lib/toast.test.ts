import type { ExternalToast } from "sonner";
import { beforeEach, expect, it, vi } from "vitest";

const calls: { kind: string; data: ExternalToast | undefined }[] = [];
const record = (kind: string) => (_: unknown, data?: ExternalToast) => {
  calls.push({ kind, data });
  return 1;
};

vi.mock("sonner", () => ({
  toast: Object.assign(record("toast"), {
    dismiss: vi.fn(),
    error: record("error"),
    info: record("info"),
    message: record("message"),
    success: record("success"),
    warning: record("warning"),
  }),
}));

const logged: unknown[][] = [];
vi.mock("./logger", () => ({
  logger: { error: (...args: unknown[]) => logged.push(args) },
}));

const { setToastDeveloperMode, spokenMessage, toast } = await import("./toast");
const { ORPCError } = await import("@orpc/client");

const action = { label: "Show", onClick: () => {} };

it("picks how long a toast stays from what it carries", () => {
  const cases: [string, () => unknown][] = [
    ["title only", () => toast.success("Saved the log")],
    [
      "description",
      () => toast.message("Merged", { description: "Both kept." }),
    ],
    ["action", () => toast.success("Downloaded", { action })],
    ["error", () => toast.error("Couldn't save the log")],
    ["error with action", () => toast.error("Couldn't install", { action })],
    ["plain call", () => toast("Copied the question")],
    [
      "caller's own duration",
      () => toast.error("Signed out", { duration: 3000 }),
    ],
  ];
  const rows = cases.map(([name, show]) => {
    calls.length = 0;
    show();
    return `${name}: ${calls.map((c) => `${c.kind} ${String(c.data?.duration)}`).join()}`;
  });
  expect(rows).toMatchInlineSnapshot(`
    [
      "title only: success 4000",
      "description: message 6000",
      "action: success 8000",
      "error: error Infinity",
      "error with action: error Infinity",
      "plain call: toast 4000",
      "caller's own duration: error 3000",
    ]
  `);
});

beforeEach(() => {
  calls.length = 0;
  logged.length = 0;
  setToastDeveloperMode(false);
});

it("keeps an error's cause off the toast and in the log", () => {
  const cause = new Error("ENOENT: no such file or directory");
  toast.error("Couldn't open the file", { cause });
  expect(calls[0]?.data?.description).toBeUndefined();
  expect(calls[0]?.data).not.toHaveProperty("cause");
  expect(logged).toEqual([["Couldn't open the file", cause]]);
});

it("shows an error's cause in developer mode, after the caller's words", () => {
  setToastDeveloperMode(true);
  toast.error("Couldn't delete the chat", {
    cause: new Error("EBUSY"),
    description: "Close anything using its folders.",
  });
  expect(JSON.stringify(calls[0]?.data?.description)).toContain("EBUSY");
  expect(JSON.stringify(calls[0]?.data?.description)).toContain(
    "Close anything using its folders.",
  );
});

it("shows developer toasts only in developer mode, marked", () => {
  toast.dev("Switch canceled");
  expect(calls).toEqual([]);
  setToastDeveloperMode(true);
  toast.dev("Switch canceled");
  expect(calls[0]?.data?.icon).toBeDefined();
  expect(calls[0]?.data?.classNames?.toast).toContain("ring-dev");
});

it("passes an error's message through only for the codes named", () => {
  const inUse = new ORPCError("NAME_IN_USE", {
    message: "Something with that name is already there",
  });
  expect(spokenMessage(inUse, ["NAME_IN_USE"])).toBe(
    "Something with that name is already there",
  );
  expect(spokenMessage(inUse, ["NAME_INVALID"])).toBeUndefined();
  expect(spokenMessage(new Error("raw"), ["NAME_IN_USE"])).toBeUndefined();
});
