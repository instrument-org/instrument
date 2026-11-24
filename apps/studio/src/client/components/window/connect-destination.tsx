/** The host a key or sign-in goes to, in the words that lead into it. */
export function Destination({
  children,
  origin,
}: {
  children: string;
  origin: string | undefined;
}) {
  if (origin === undefined) {
    return null;
  }
  const [, runtime, packageName] =
    /^(node|python)-package:(.+)$/.exec(origin) ?? [];
  const host =
    packageName === undefined
      ? (URL.parse(origin)?.host ?? origin)
      : `the ${runtime === "node" ? "npm" : "PyPI"} package ${packageName}`;
  return (
    <p className="text-xs text-muted-foreground">
      {children} <span className="font-medium text-foreground">{host}</span>.
    </p>
  );
}
