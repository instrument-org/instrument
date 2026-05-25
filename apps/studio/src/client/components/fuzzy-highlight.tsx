import uFuzzy from "@leeoniya/ufuzzy";

export function FuzzyHighlight({
  ranges,
  text,
}: {
  ranges: null | number[];
  text: string;
}) {
  if (!ranges) {
    return <span>{text}</span>;
  }

  const parts = uFuzzy.highlight(
    text,
    ranges,
    (part, matched) => ({ matched, part }),
    [] as { matched: boolean; part: string }[],
    (acc, item) => {
      acc.push(item);
    },
  );

  return (
    <span>
      {parts.map((p, i) =>
        p.matched ? (
          <mark
            className="bg-transparent font-semibold text-foreground"
            key={i}
          >
            {p.part}
          </mark>
        ) : (
          <span key={i}>{p.part}</span>
        ),
      )}
    </span>
  );
}
