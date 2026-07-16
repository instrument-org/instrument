export function getBrowserDomains(command: string): string[] {
  const domainCounts = new Map<string, number>();

  for (const match of command.matchAll(/https?:\/\/[^\s"'`]+/g)) {
    try {
      const hostname = new URL(match[0]).hostname.replace(/^www\./, "");
      domainCounts.set(hostname, (domainCounts.get(hostname) ?? 0) + 1);
    } catch {
      // Ignore malformed URL-like arguments.
    }
  }

  return [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([domain]) => domain);
}
