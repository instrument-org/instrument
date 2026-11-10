/**
 * What a project can be marked with besides an emoji: a Phosphor icon from a
 * curated set, by its name, and a color from a short palette. The app draws
 * them and the agent sets them, so both read the one list here, and a name
 * outside it is one no build draws.
 */

/** The icons, in the picker's order, a heading over each group, each with the words a search finds it by. */
export const PROJECT_ICON_GROUPS = [
  {
    icons: [
      { name: "house", words: ["home", "house", "family"] },
      {
        name: "sun",
        words: ["sun", "summer", "day", "weather"],
      },
      {
        name: "moon-stars",
        words: ["night", "sleep", "moon", "evening"],
      },
      {
        name: "coffee",
        words: ["coffee", "cafe", "morning", "drink"],
      },
      {
        name: "heart",
        words: ["love", "heart", "health", "favorite", "dating"],
      },
      {
        name: "star",
        words: ["star", "favorite", "important"],
      },
      {
        name: "smiley",
        words: ["smile", "happy", "fun", "mood"],
      },
      {
        name: "leaf",
        words: ["leaf", "plant", "nature", "green"],
      },
      { name: "plant", words: ["plant", "garden", "grow"] },
      {
        name: "flower",
        words: ["flower", "garden", "spring"],
      },
      {
        name: "tree",
        words: ["tree", "nature", "forest", "outdoors"],
      },
      {
        name: "mountains",
        words: ["mountain", "hike", "outdoors", "climb"],
      },
      {
        name: "airplane",
        words: ["travel", "flight", "trip", "airplane", "vacation"],
      },
      {
        name: "car",
        words: ["car", "drive", "auto", "vehicle"],
      },
      {
        name: "bicycle",
        words: ["bike", "cycling", "bicycle", "ride"],
      },
      {
        name: "barbell",
        words: ["gym", "fitness", "workout", "weights", "exercise"],
      },
      {
        name: "person-simple-run",
        words: ["run", "running", "exercise", "fitness"],
      },
      {
        name: "basketball",
        words: ["sports", "ball", "basketball"],
      },
      {
        name: "soccer-ball",
        words: ["soccer", "football", "sports"],
      },
      {
        name: "music-notes",
        words: ["music", "song", "band"],
      },
      {
        name: "film-slate",
        words: ["film", "movie", "video"],
      },
      {
        name: "camera",
        words: ["camera", "photo", "photography"],
      },
      {
        name: "palette",
        words: ["art", "paint", "color", "design"],
      },
      {
        name: "pencil-simple",
        words: ["write", "pencil", "edit", "draft"],
      },
      {
        name: "paint-brush",
        words: ["paint", "art", "brush"],
      },
      {
        name: "cooking-pot",
        words: ["cooking", "recipe", "kitchen", "food", "meal"],
      },
      {
        name: "fork-knife",
        words: ["food", "restaurant", "dinner", "eat", "meal"],
      },
      {
        name: "gift",
        words: ["gift", "present", "birthday", "holiday"],
      },
      {
        name: "calendar",
        words: ["calendar", "schedule", "date", "plan", "events"],
      },
      {
        name: "alarm",
        words: ["alarm", "reminder", "time", "wake"],
      },
      {
        name: "clock",
        words: ["time", "clock", "hours", "schedule"],
      },
      {
        name: "umbrella",
        words: ["umbrella", "rain", "weather", "insurance"],
      },
      { name: "dog", words: ["dog", "pet", "puppy"] },
      { name: "cat", words: ["cat", "pet", "kitten"] },
      { name: "bird", words: ["bird", "birding", "twitter"] },
      { name: "fish", words: ["fish", "fishing", "aquarium"] },
      {
        name: "paw-print",
        words: ["pet", "animal", "paw", "vet"],
      },
      {
        name: "baby",
        words: ["baby", "kid", "child", "parenting"],
      },
      {
        name: "users-three",
        words: ["family", "people", "team", "group", "friends"],
      },
      {
        name: "user",
        words: ["person", "profile", "me", "personal"],
      },
    ],
    label: "Everyday",
  },
  {
    icons: [
      {
        name: "briefcase",
        words: ["work", "job", "career", "business", "office"],
      },
      {
        name: "flask",
        words: ["science", "lab", "research", "experiment", "chemistry"],
      },
      {
        name: "rocket-launch",
        words: ["launch", "startup", "ship", "rocket", "project"],
      },
      {
        name: "lightbulb",
        words: ["idea", "brainstorm", "invention", "lightbulb"],
      },
      {
        name: "image",
        words: ["image", "picture", "photo", "gallery", "design"],
      },
      {
        name: "code",
        words: ["code", "programming", "developer", "software"],
      },
      {
        name: "terminal-window",
        words: ["terminal", "command", "shell", "scripting"],
      },
      {
        name: "envelope-simple",
        words: ["email", "mail", "inbox", "newsletter"],
      },
      {
        name: "chats-circle",
        words: ["chat", "messages", "conversation", "support"],
      },
      { name: "phone", words: ["phone", "call", "contact"] },
      {
        name: "presentation-chart",
        words: ["presentation", "slides", "deck", "pitch"],
      },
      {
        name: "chart-line-up",
        words: ["growth", "chart", "metrics", "analytics", "stocks"],
      },
      {
        name: "chart-bar",
        words: ["chart", "stats", "report", "data"],
      },
      {
        name: "chart-pie-slice",
        words: ["chart", "pie", "budget", "share"],
      },
      {
        name: "target",
        words: ["goal", "target", "objective", "focus"],
      },
      { name: "kanban", words: ["kanban", "board", "tasks"] },
      {
        name: "list-checks",
        words: ["checklist", "todo", "tasks", "list"],
      },
      {
        name: "check-square",
        words: ["done", "todo", "task", "check"],
      },
      {
        name: "clipboard-text",
        words: ["clipboard", "notes", "report"],
      },
      {
        name: "note-pencil",
        words: ["notes", "note", "writing", "journal"],
      },
      {
        name: "notebook",
        words: ["notebook", "notes", "journal", "diary"],
      },
      {
        name: "file-text",
        words: ["document", "file", "text", "doc"],
      },
      {
        name: "files",
        words: ["files", "documents", "folder", "paperwork"],
      },
      {
        name: "folder-simple",
        words: ["folder", "files", "archive"],
      },
      {
        name: "archive",
        words: ["archive", "storage", "boxes"],
      },
      { name: "tray", words: ["inbox", "tray"] },
      {
        name: "printer",
        words: ["print", "printer", "office"],
      },
      {
        name: "handshake",
        words: ["deal", "partnership", "client", "agreement"],
      },
      {
        name: "megaphone",
        words: ["marketing", "announcement", "campaign", "ads", "promotion"],
      },
      {
        name: "storefront",
        words: ["store", "shop", "retail", "business"],
      },
      {
        name: "buildings",
        words: ["company", "office", "building", "real", "estate", "city"],
      },
      {
        name: "identification-card",
        words: ["id", "card", "identity", "hr", "hiring"],
      },
      {
        name: "user-plus",
        words: ["hiring", "recruiting", "new", "person"],
      },
      {
        name: "users",
        words: ["team", "people", "members", "clients"],
      },
      {
        name: "gavel",
        words: ["legal", "law", "court", "contract"],
      },
      {
        name: "scales",
        words: ["legal", "law", "justice", "balance"],
      },
      {
        name: "shield-check",
        words: ["security", "safety", "privacy", "compliance"],
      },
      {
        name: "lock",
        words: ["lock", "security", "password", "private"],
      },
      { name: "key", words: ["key", "access", "password"] },
      {
        name: "wrench",
        words: ["tools", "repair", "fix", "maintenance"],
      },
      {
        name: "gear",
        words: ["settings", "config", "gear", "system"],
      },
      {
        name: "hammer",
        words: ["build", "construction", "diy", "tools"],
      },
      {
        name: "toolbox",
        words: ["tools", "toolbox", "diy", "repair"],
      },
      {
        name: "bug",
        words: ["bug", "debugging", "issue", "testing"],
      },
      {
        name: "git-branch",
        words: ["git", "branch", "code", "version"],
      },
      {
        name: "database",
        words: ["database", "data", "sql", "storage"],
      },
      {
        name: "cloud",
        words: ["cloud", "server", "hosting", "weather"],
      },
      { name: "cpu", words: ["computer", "hardware", "chip"] },
      {
        name: "desktop",
        words: ["computer", "desktop", "monitor"],
      },
      { name: "laptop", words: ["laptop", "computer"] },
      {
        name: "device-mobile",
        words: ["phone", "mobile", "app", "ios", "android"],
      },
      {
        name: "robot",
        words: ["robot", "ai", "automation", "bot"],
      },
      {
        name: "sparkle",
        words: ["ai", "magic", "new", "sparkle"],
      },
      {
        name: "magic-wand",
        words: ["magic", "ai", "wand", "automation"],
      },
      {
        name: "puzzle-piece",
        words: ["puzzle", "plugin", "integration", "extension"],
      },
      {
        name: "plug",
        words: ["plug", "integration", "power", "connection"],
      },
      {
        name: "globe",
        words: ["web", "website", "world", "internet", "global"],
      },
      { name: "link", words: ["link", "url", "web"] },
      {
        name: "browser",
        words: ["browser", "website", "web", "page"],
      },
      {
        name: "newspaper",
        words: ["news", "newspaper", "press", "article", "blog"],
      },
      {
        name: "article",
        words: ["article", "blog", "post", "writing"],
      },
      {
        name: "pen-nib",
        words: ["writing", "pen", "design", "copy"],
      },
      {
        name: "quotes",
        words: ["quotes", "writing", "quote"],
      },
      {
        name: "translate",
        words: ["language", "translate", "translation"],
      },
      {
        name: "microphone",
        words: ["podcast", "audio", "mic", "recording", "voice"],
      },
      {
        name: "headphones",
        words: ["music", "audio", "podcast", "listening"],
      },
      {
        name: "video-camera",
        words: ["video", "recording", "youtube", "vlog"],
      },
    ],
    label: "Work",
  },
  {
    icons: [
      {
        name: "currency-dollar",
        words: ["money", "dollar", "finance", "pay"],
      },
      {
        name: "money",
        words: ["money", "cash", "finance", "budget"],
      },
      {
        name: "wallet",
        words: ["wallet", "money", "spending", "budget"],
      },
      {
        name: "credit-card",
        words: ["card", "payment", "credit", "bills"],
      },
      { name: "bank", words: ["bank", "finance", "savings"] },
      {
        name: "piggy-bank",
        words: ["savings", "piggy", "bank", "money", "budget"],
      },
      {
        name: "coins",
        words: ["coins", "money", "crypto", "savings"],
      },
      {
        name: "receipt",
        words: ["receipt", "expenses", "bills", "taxes"],
      },
      {
        name: "calculator",
        words: ["calculator", "math", "taxes", "accounting"],
      },
      {
        name: "invoice",
        words: ["invoice", "billing", "accounting"],
      },
      {
        name: "shopping-cart",
        words: ["shopping", "cart", "groceries", "store", "buy"],
      },
      {
        name: "shopping-bag",
        words: ["shopping", "bag", "store", "buy", "clothes"],
      },
      { name: "tag", words: ["tag", "price", "label", "sale"] },
      {
        name: "package",
        words: ["package", "shipping", "delivery", "box", "order"],
      },
      {
        name: "truck",
        words: ["truck", "shipping", "delivery", "moving"],
      },
      {
        name: "trend-up",
        words: ["trend", "growth", "investing", "up", "stocks"],
      },
    ],
    label: "Money",
  },
  {
    icons: [
      {
        name: "map-trifold",
        words: ["map", "travel", "trip", "directions"],
      },
      {
        name: "map-pin",
        words: ["place", "location", "pin", "map", "address"],
      },
      {
        name: "compass",
        words: ["compass", "explore", "navigation"],
      },
      {
        name: "suitcase-rolling",
        words: ["luggage", "travel", "trip", "vacation", "packing"],
      },
      {
        name: "airplane-tilt",
        words: ["flight", "airplane", "travel", "takeoff"],
      },
      {
        name: "train",
        words: ["train", "travel", "rail", "commute"],
      },
      { name: "bus", words: ["bus", "transit", "commute"] },
      { name: "boat", words: ["boat", "sailing", "sea"] },
      {
        name: "sailboat",
        words: ["sailing", "boat", "sea"],
      },
      { name: "tent", words: ["camping", "tent", "outdoors"] },
      {
        name: "campfire",
        words: ["camping", "fire", "outdoors"],
      },
      {
        name: "island",
        words: ["island", "beach", "vacation", "holiday"],
      },
      { name: "park", words: ["park", "outdoors", "city"] },
      { name: "city", words: ["city", "urban", "town"] },
      { name: "bed", words: ["bed", "sleep", "hotel", "rest"] },
      {
        name: "building-apartment",
        words: ["apartment", "flat", "rent", "housing"],
      },
      {
        name: "house-line",
        words: ["house", "real", "estate", "property"],
      },
    ],
    label: "Travel and places",
  },
  {
    icons: [
      { name: "pizza", words: ["pizza", "food"] },
      {
        name: "hamburger",
        words: ["burger", "food", "fast", "food"],
      },
      {
        name: "carrot",
        words: ["carrot", "vegetables", "food", "garden"],
      },
      {
        name: "orange-slice",
        words: ["fruit", "orange", "food"],
      },
      {
        name: "cake",
        words: ["cake", "birthday", "baking", "dessert"],
      },
      {
        name: "cookie",
        words: ["cookie", "baking", "dessert"],
      },
      { name: "bread", words: ["bread", "baking", "food"] },
      { name: "wine", words: ["wine", "drink", "alcohol"] },
      {
        name: "beer-stein",
        words: ["beer", "drink", "pub"],
      },
      {
        name: "martini",
        words: ["cocktail", "drink", "bar"],
      },
      {
        name: "bowl-food",
        words: ["bowl", "food", "meal", "soup"],
      },
      { name: "egg", words: ["egg", "breakfast", "food"] },
    ],
    label: "Food and drink",
  },
  {
    icons: [
      {
        name: "first-aid-kit",
        words: ["first", "aid", "health", "medical"],
      },
      {
        name: "heartbeat",
        words: ["health", "heart", "medical", "fitness"],
      },
      {
        name: "pill",
        words: ["pill", "medicine", "health", "pharmacy"],
      },
      {
        name: "stethoscope",
        words: ["doctor", "medical", "health"],
      },
      { name: "tooth", words: ["dentist", "tooth", "teeth"] },
      {
        name: "brain",
        words: ["brain", "mind", "psychology", "thinking", "mental"],
      },
      {
        name: "hand-heart",
        words: ["care", "charity", "volunteer", "kindness"],
      },
      {
        name: "person-simple-tai-chi",
        words: ["yoga", "meditation", "wellness"],
      },
      { name: "drop", words: ["water", "drop", "hydration"] },
      {
        name: "bandaids",
        words: ["bandaid", "injury", "first", "aid"],
      },
    ],
    label: "Health",
  },
  {
    icons: [
      {
        name: "book-open",
        words: ["book", "reading", "study", "library"],
      },
      {
        name: "books",
        words: ["books", "reading", "library", "study"],
      },
      {
        name: "book-bookmark",
        words: ["book", "reading", "bookmark"],
      },
      {
        name: "bookmark-simple",
        words: ["bookmark", "save", "reading"],
      },
      {
        name: "graduation-cap",
        words: ["school", "graduation", "university", "college", "education"],
      },
      {
        name: "student",
        words: ["student", "school", "class", "learning"],
      },
      {
        name: "chalkboard-teacher",
        words: ["teaching", "class", "lesson", "teacher"],
      },
      {
        name: "exam",
        words: ["exam", "test", "quiz", "study"],
      },
      {
        name: "certificate",
        words: ["certificate", "award", "degree"],
      },
      { name: "atom", words: ["physics", "science", "atom"] },
      {
        name: "dna",
        words: ["biology", "dna", "genetics", "science"],
      },
      {
        name: "microscope",
        words: ["science", "lab", "research", "biology"],
      },
      {
        name: "globe-hemisphere-west",
        words: ["geography", "world", "earth"],
      },
      {
        name: "math-operations",
        words: ["math", "numbers", "calculation"],
      },
    ],
    label: "Learning",
  },
  {
    icons: [
      {
        name: "pencil-ruler",
        words: ["design", "drafting", "architecture"],
      },
      { name: "pen", words: ["pen", "writing", "sign"] },
      {
        name: "paint-bucket",
        words: ["paint", "fill", "color"],
      },
      {
        name: "scissors",
        words: ["scissors", "craft", "cut"],
      },
      {
        name: "needle",
        words: ["sewing", "craft", "knitting"],
      },
      { name: "guitar", words: ["guitar", "music", "band"] },
      {
        name: "piano-keys",
        words: ["piano", "music", "keys"],
      },
      {
        name: "microphone-stage",
        words: ["singing", "stage", "performance", "concert"],
      },
      {
        name: "film-strip",
        words: ["film", "movie", "photo"],
      },
      {
        name: "aperture",
        words: ["photography", "camera", "lens"],
      },
      {
        name: "frame-corners",
        words: ["frame", "design", "crop"],
      },
      {
        name: "shapes",
        words: ["shapes", "design", "geometry"],
      },
      {
        name: "cube",
        words: ["3d", "cube", "model", "product"],
      },
      {
        name: "sketch-logo",
        words: ["sketch", "design", "ui"],
      },
      {
        name: "figma-logo",
        words: ["figma", "design", "ui"],
      },
      {
        name: "game-controller",
        words: ["games", "gaming", "video", "games"],
      },
      {
        name: "dice-five",
        words: ["dice", "games", "board", "games"],
      },
      {
        name: "crown",
        words: ["crown", "king", "royal", "premium"],
      },
      {
        name: "trophy",
        words: ["trophy", "award", "winner", "competition"],
      },
      {
        name: "medal",
        words: ["medal", "award", "achievement"],
      },
      {
        name: "confetti",
        words: ["party", "celebration", "event"],
      },
      {
        name: "balloon",
        words: ["balloon", "party", "birthday"],
      },
      {
        name: "ticket",
        words: ["ticket", "event", "concert", "show"],
      },
      {
        name: "mask-happy",
        words: ["theater", "drama", "acting"],
      },
    ],
    label: "Creative",
  },
  {
    icons: [
      {
        name: "couch",
        words: ["couch", "living", "room", "furniture"],
      },
      {
        name: "armchair",
        words: ["chair", "furniture", "interior"],
      },
      { name: "lamp", words: ["lamp", "light", "interior"] },
      {
        name: "broom",
        words: ["cleaning", "chores", "broom"],
      },
      {
        name: "washing-machine",
        words: ["laundry", "chores"],
      },
      { name: "shower", words: ["bathroom", "shower"] },
      {
        name: "toilet-paper",
        words: ["bathroom", "supplies"],
      },
      { name: "door", words: ["door", "house", "entrance"] },
      { name: "garage", words: ["garage", "car", "storage"] },
      {
        name: "lightning",
        words: ["electric", "power", "energy", "lightning", "fast"],
      },
      {
        name: "fire",
        words: ["fire", "hot", "trending", "fireplace"],
      },
      {
        name: "snowflake",
        words: ["winter", "snow", "cold", "ski"],
      },
      { name: "cloud-rain", words: ["rain", "weather"] },
      {
        name: "thermometer",
        words: ["temperature", "weather", "heat"],
      },
      {
        name: "t-shirt",
        words: ["clothes", "fashion", "shirt"],
      },
      {
        name: "dress",
        words: ["dress", "fashion", "clothes"],
      },
      {
        name: "sneaker",
        words: ["shoes", "sneaker", "running", "fashion"],
      },
      { name: "watch", words: ["watch", "time"] },
      {
        name: "eyeglasses",
        words: ["glasses", "reading", "vision"],
      },
      {
        name: "baby-carriage",
        words: ["baby", "stroller", "parenting"],
      },
      {
        name: "church",
        words: ["church", "religion", "faith"],
      },
      {
        name: "hands-praying",
        words: ["prayer", "faith", "gratitude"],
      },
    ],
    label: "Home and life",
  },
  {
    icons: [
      {
        name: "flag",
        words: ["flag", "goal", "milestone", "country"],
      },
      {
        name: "bell",
        words: ["bell", "notification", "alerts", "reminder"],
      },
      { name: "info", words: ["info", "information", "help"] },
      {
        name: "question",
        words: ["question", "help", "faq"],
      },
      {
        name: "warning",
        words: ["warning", "alert", "caution", "risk"],
      },
      {
        name: "check-circle",
        words: ["done", "complete", "check", "approved"],
      },
      {
        name: "x-circle",
        words: ["cancel", "no", "reject"],
      },
      {
        name: "hash",
        words: ["hashtag", "number", "channel", "tag"],
      },
      { name: "at", words: ["at", "email", "mention"] },
      { name: "asterisk", words: ["asterisk", "note"] },
      {
        name: "infinity",
        words: ["infinity", "forever", "loop"],
      },
      {
        name: "hourglass",
        words: ["hourglass", "time", "waiting", "deadline"],
      },
      {
        name: "lightning-a",
        words: ["automation", "flash"],
      },
      {
        name: "anchor",
        words: ["anchor", "sea", "navy", "stable"],
      },
      {
        name: "fingerprint",
        words: ["fingerprint", "identity", "security"],
      },
      {
        name: "eye",
        words: ["eye", "watch", "view", "visibility"],
      },
      {
        name: "magnifying-glass",
        words: ["search", "find", "research"],
      },
      {
        name: "sun-horizon",
        words: ["sunrise", "sunset", "morning"],
      },
      {
        name: "rainbow",
        words: ["rainbow", "pride", "color"],
      },
      { name: "peace", words: ["peace", "calm"] },
      {
        name: "yin-yang",
        words: ["balance", "yin", "yang"],
      },
      { name: "circle", words: ["circle", "dot", "shape"] },
      { name: "square", words: ["square", "shape"] },
      { name: "triangle", words: ["triangle", "shape"] },
      {
        name: "diamond",
        words: ["diamond", "gem", "shape"],
      },
      { name: "hexagon", words: ["hexagon", "shape"] },
      {
        name: "cards-three",
        words: ["cards", "projects", "stack"],
      },
      { name: "stack", words: ["stack", "layers", "pile"] },
      {
        name: "squares-four",
        words: ["grid", "apps", "dashboard"],
      },
    ],
    label: "Symbols",
  },
] as const satisfies readonly {
  icons: readonly { name: string; words: readonly string[] }[];
  label: string;
}[];

export type ProjectIconName =
  (typeof PROJECT_ICON_GROUPS)[number]["icons"][number]["name"];

/** One icon of the set, by its name and the words a search finds it by. */
export interface ProjectIconEntry {
  name: ProjectIconName;
  words: readonly string[];
}

/** Every icon once, in the picker's order. */
export const PROJECT_ICONS: readonly ProjectIconEntry[] =
  PROJECT_ICON_GROUPS.flatMap(
    ({ icons }): readonly ProjectIconEntry[] => icons,
  );

const ICON_NAMES: ReadonlySet<string> = new Set(
  PROJECT_ICONS.map((icon) => icon.name),
);

export function isProjectIconName(name: string): name is ProjectIconName {
  return ICON_NAMES.has(name);
}

/** A word with a plural's `s` taken off, so "books" finds "book". */
function stem(word: string) {
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
}

function ownWords(icon: ProjectIconEntry) {
  return [...icon.words, ...icon.name.split("-")];
}

/** How well one icon fits the words: 3 for a word it is found by, 1 for a start of one, 0 for none. */
function fit(icon: ProjectIconEntry, words: readonly string[]) {
  let score = 0;
  for (const word of words) {
    const wanted = stem(word);
    const best = Math.max(
      0,
      ...ownWords(icon).map((own) => {
        const mine = stem(own);
        if (mine === wanted) {
          return 3;
        }
        return wanted.length >= 3 && mine.startsWith(wanted) ? 1 : 0;
      }),
    );
    score += best;
  }
  return score;
}

function wordsOf(text: string) {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2);
}

/**
 * The icons a search finds, best fit first: every word typed has to match
 * the start of one of an icon's words, so the list narrows as it is typed.
 */
export function searchProjectIcons(query: string): ProjectIconEntry[] {
  const words = wordsOf(query);
  if (words.length === 0) {
    return [];
  }
  return PROJECT_ICONS.map((icon) => ({
    icon,
    matched: words.every((word) =>
      ownWords(icon).some((own) => own.startsWith(word)),
    ),
    score: fit(icon, words),
  }))
    .filter(({ matched }) => matched)
    .toSorted((a, b) => b.score - a.score)
    .map(({ icon }) => icon);
}

/**
 * Icons that fit any of the words, best first and at most `limit`: whole
 * words before starts of words, the set's own order breaking ties.
 */
export function suggestProjectIcons(
  text: string,
  limit = 8,
): ProjectIconEntry[] {
  const words = wordsOf(text);
  if (words.length === 0) {
    return [];
  }
  return PROJECT_ICONS.map((icon) => ({ icon, score: fit(icon, words) }))
    .filter(({ score }) => score > 0)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ icon }) => icon);
}

/**
 * The palette, by name: eight hues, each once pale and once deep, rebuilt at
 * one lightness and chroma in OKLCH so no two are louder or quieter than each
 * other. Only a color's hue and its tier survive the tint, so the pairs are
 * what a person actually picks between. In the picker's order: the pale row,
 * then the deep one, a hue to a column.
 */
export const PROJECT_COLOR_HEXES = {
  "pale-red": "#f2a7a6",
  "pale-orange": "#ebaf86",
  "pale-gold": "#d4bc79",
  "pale-green": "#99ce9a",
  "pale-teal": "#78d1c0",
  "pale-blue": "#82c7f0",
  "pale-violet": "#bcb4f4",
  "pale-pink": "#e8a7cb",
  "deep-red": "#c0434c",
  "deep-orange": "#b85300",
  "deep-gold": "#996d00",
  "deep-green": "#218b30",
  "deep-teal": "#009178",
  "deep-blue": "#007fc3",
  "deep-violet": "#765fca",
  "deep-pink": "#b2468a",
} as const;

export type ProjectColorName = keyof typeof PROJECT_COLOR_HEXES;

export const PROJECT_COLOR_NAMES = Object.keys(
  PROJECT_COLOR_HEXES,
) as readonly ProjectColorName[]; // Object.keys widens to string[]; these are exactly the record's keys.

/** The palette's hexes, the pale row and then the deep one. */
export const PROJECT_COLORS: readonly string[] =
  Object.values(PROJECT_COLOR_HEXES);

/** How many hues the palette has, which is the width of a row of swatches. */
export const PROJECT_HUES = 8;

/** A color's palette name, or nothing for one from outside the palette. */
export function projectColorName(hex: string): ProjectColorName | undefined {
  const lowered = hex.toLowerCase();
  return PROJECT_COLOR_NAMES.find(
    (name) => PROJECT_COLOR_HEXES[name] === lowered,
  );
}
