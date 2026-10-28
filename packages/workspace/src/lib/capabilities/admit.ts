import { type Role, type Where } from "./define";

/**
 * Why a capability is not there for a call, in the words the call is
 * refused with, or nothing when it is: its platform, its build, the role of
 * the session calling. The same answer on every surface, the model's tools
 * included.
 */
export function unavailableReason(
  { name, where }: { name: string; where?: Where },
  role: Role,
): string | undefined {
  if (where?.roles?.includes(role) === false) {
    return (
      where.roleRefusal ??
      `only the chat has ${name}. Say in your report what the chat should do with it.`
    );
  }
  if (
    where?.platforms?.includes(process.platform) === false ||
    where?.available?.() === false
  ) {
    return `${name} is not available on this computer.`;
  }
  return undefined;
}
