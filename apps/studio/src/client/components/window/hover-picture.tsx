/**
 * A small picture of a tab or a tab group as it was last up, on the card
 * shown on hovering it. Cut at its foot where it is taller than the card.
 */
export function HoverPicture({ url }: { url: string }) {
  return (
    <img
      alt=""
      className="block max-h-80 w-full object-cover object-top-left"
      // Drawn with the card rather than a frame after it.
      decoding="sync"
      src={url}
    />
  );
}
