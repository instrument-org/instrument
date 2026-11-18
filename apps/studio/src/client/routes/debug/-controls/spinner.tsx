import { Spinner } from "@/client/components/ui/spinner";

import { DebugState } from "../-shell";

/** The sizes the app draws the spinner at. */
const sizes: { className: string; label: string; thickness?: number }[] = [
  { className: "size-3", label: "12px, in an extra-small button" },
  { className: "size-3.5", label: "14px, in a small button" },
  { className: "size-4", label: "16px, the default" },
  { className: "size-5", label: "20px" },
  { className: "size-6", label: "24px" },
  { className: "size-8", label: "32px, for a whole pane" },
  {
    className: "size-8 text-muted-foreground",
    label: "32px with a 1.5px ring, around the jump-to-latest button",
    thickness: 1.5,
  },
];

/** The Controls page's spinner, at every size the app draws it, side by side. */
export function SpinnerTab() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8">
      <p className="text-sm text-muted-foreground">
        The ring the app turns while something loads. Most spinners wait a
        moment before they appear, so a quick load shows nothing. These all
        appear at once.
      </p>
      <DebugState id="spinner-sizes">
        <div className="flex flex-wrap items-start gap-x-6 gap-y-8">
          {sizes.map((s) => (
            <div
              className="flex w-24 flex-col items-center gap-3 text-center"
              key={s.label}
            >
              <div className="flex h-8 items-center justify-center">
                <Spinner
                  className={s.className}
                  delay={0}
                  thickness={s.thickness}
                />
              </div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </DebugState>
    </div>
  );
}
