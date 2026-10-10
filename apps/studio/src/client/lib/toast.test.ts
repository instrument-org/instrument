import type { ExternalToast } from "sonner";
import { expect, it, vi } from "vitest";

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

const { toast } = await import("./toast");

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
