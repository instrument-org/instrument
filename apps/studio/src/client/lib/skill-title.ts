/**
 * Human-facing name for a skill.
 *
 * A skill's identity on disk is its kebab-case directory, and the slash form is
 * how it is invoked, but neither reads as a name to someone who has not been
 * told what they mean. Titles are for people; use the raw name for anything the
 * agent or the filesystem consumes.
 */
export function skillTitle(name: string) {
  return name
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
