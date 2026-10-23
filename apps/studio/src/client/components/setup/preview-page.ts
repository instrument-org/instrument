import { type SetupStep } from "@/shared/setup";

/** The session key a development run sets to open a step on one of its pages. */
const PREVIEW_KEY = "setup.preview";

/**
 * In a development build, the page `step` opens on in place of its first,
 * for the pages a run can't reach on its own: a third-party sign-in's
 * answer, or a trial started on a real account. Set it and reload:
 * `sessionStorage.setItem("setup.preview", JSON.stringify({ step: "choose-ai",
 * page: { kind: "outcome", provider: "chatgpt", outcome: { kind: "no-plan" } } }))`.
 */
export function previewPage<Page>(step: SetupStep): Page | undefined {
  if (!import.meta.env.DEV) {
    return undefined;
  }
  try {
    const raw = sessionStorage.getItem(PREVIEW_KEY);
    // Typed by the caller: a developer's own hand-written page, never stored data.
    const preview = raw
      ? (JSON.parse(raw) as { page: Page; step: string })
      : undefined;
    return preview?.step === step ? preview.page : undefined;
  } catch {
    return undefined;
  }
}
