/**
 * The colors a development instance is marked with, as a dot in its Dock
 * icon's corner and on the dev panel's pill, so several running at once tell
 * apart at a glance. The deep tier of the topic palette
 * (client/components/window/topic-colors.ts) without gray, which the
 * development icon already is, and purple, which a preview build wears.
 * studio-drive hands them out, so an instance a person started by hand has
 * none.
 *
 * Imports nothing, so studio-drive.mjs and the dev supervisor can load it
 * straight from source.
 */
export const DEV_INSTANCE_COLORS = {
  red: "#c0434c",
  orange: "#b85300",
  green: "#218b30",
  teal: "#009178",
  blue: "#007fc3",
  pink: "#b2468a",
} as const;

export type DevInstanceColor = keyof typeof DEV_INSTANCE_COLORS;

export function isDevInstanceColor(
  value: string | undefined,
): value is DevInstanceColor {
  return value !== undefined && Object.hasOwn(DEV_INSTANCE_COLORS, value);
}
