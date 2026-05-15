import { tv } from "tailwind-variants";

// Using `tv` to ensure lint etc see these styles
export const SHARED = tv({
  slots: {
    brandGradient: [
      "[background:linear-gradient(180deg,var(--brand-200)_0%,var(--brown-50)_100%)]",
      "dark:[background:linear-gradient(180deg,color-mix(in_srgb,var(--brand-950)_60%,var(--background))_0%,var(--background)_50%)]",
    ].join(" "),
  },
})();
