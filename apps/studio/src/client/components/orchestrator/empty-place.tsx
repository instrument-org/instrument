/**
 * A place the rail names before anything is built behind it: the whole area
 * right of the rail, with the place's name at its head and one quiet line
 * under it, so the rail's entry lands somewhere rather than nowhere.
 */
export function EmptyPlace({ title }: { title: string }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col px-8 pt-7">
      <h1 className="text-[28px] leading-9 font-semibold">{title}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Nothing here yet.</p>
    </div>
  );
}
