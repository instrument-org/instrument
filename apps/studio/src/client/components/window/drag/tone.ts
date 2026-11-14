/** The tone of a place that takes what is held: a side's page, a row it joins, the row it would make, a bookmark standing where it would be kept. A mid gray rather than the theme's foreground, so it shows over a white web page in the dark theme as well as over the app. */
export const DROP_TONE =
  "bg-[rgb(128_128_128/0.25)] ring-2 ring-[rgb(128_128_128/0.85)] ring-inset";

/** The tone of a place a drag could land before the pointer reaches it (`Drag.hints`): the drop tone's gray, faint enough to sit over a page the whole drag without taking it over. */
export const DROP_HINT_TONE =
  "bg-[rgb(128_128_128/0.08)] ring-1 ring-[rgb(128_128_128/0.45)] ring-inset";
