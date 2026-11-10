// The icons a project can be marked with: a curated set of a few hundred,
// chosen for what people file work under, each imported on its own so the
// bundle carries only these and never the whole library.
import {
  PROJECT_ICON_GROUPS as SHARED_GROUPS,
  type ProjectIconEntry,
  type ProjectIconName,
  searchProjectIcons as searchShared,
  suggestProjectIcons as suggestShared,
} from "@instrument-org/shared/project-marks";
import { type Icon } from "@phosphor-icons/react";
import { HouseIcon } from "@phosphor-icons/react/House";
import { SunIcon } from "@phosphor-icons/react/Sun";
import { MoonStarsIcon } from "@phosphor-icons/react/MoonStars";
import { CoffeeIcon } from "@phosphor-icons/react/Coffee";
import { HeartIcon } from "@phosphor-icons/react/Heart";
import { StarIcon } from "@phosphor-icons/react/Star";
import { SmileyIcon } from "@phosphor-icons/react/Smiley";
import { LeafIcon } from "@phosphor-icons/react/Leaf";
import { PlantIcon } from "@phosphor-icons/react/Plant";
import { FlowerIcon } from "@phosphor-icons/react/Flower";
import { TreeIcon } from "@phosphor-icons/react/Tree";
import { MountainsIcon } from "@phosphor-icons/react/Mountains";
import { AirplaneIcon } from "@phosphor-icons/react/Airplane";
import { CarIcon } from "@phosphor-icons/react/Car";
import { BicycleIcon } from "@phosphor-icons/react/Bicycle";
import { BarbellIcon } from "@phosphor-icons/react/Barbell";
import { PersonSimpleRunIcon } from "@phosphor-icons/react/PersonSimpleRun";
import { BasketballIcon } from "@phosphor-icons/react/Basketball";
import { SoccerBallIcon } from "@phosphor-icons/react/SoccerBall";
import { MusicNotesIcon } from "@phosphor-icons/react/MusicNotes";
import { FilmSlateIcon } from "@phosphor-icons/react/FilmSlate";
import { CameraIcon } from "@phosphor-icons/react/Camera";
import { PaletteIcon } from "@phosphor-icons/react/Palette";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { PaintBrushIcon } from "@phosphor-icons/react/PaintBrush";
import { CookingPotIcon } from "@phosphor-icons/react/CookingPot";
import { ForkKnifeIcon } from "@phosphor-icons/react/ForkKnife";
import { GiftIcon } from "@phosphor-icons/react/Gift";
import { CalendarIcon } from "@phosphor-icons/react/Calendar";
import { AlarmIcon } from "@phosphor-icons/react/Alarm";
import { ClockIcon } from "@phosphor-icons/react/Clock";
import { UmbrellaIcon } from "@phosphor-icons/react/Umbrella";
import { DogIcon } from "@phosphor-icons/react/Dog";
import { CatIcon } from "@phosphor-icons/react/Cat";
import { BirdIcon } from "@phosphor-icons/react/Bird";
import { FishIcon } from "@phosphor-icons/react/Fish";
import { PawPrintIcon } from "@phosphor-icons/react/PawPrint";
import { BabyIcon } from "@phosphor-icons/react/Baby";
import { UsersThreeIcon } from "@phosphor-icons/react/UsersThree";
import { UserIcon } from "@phosphor-icons/react/User";
import { BriefcaseIcon } from "@phosphor-icons/react/Briefcase";
import { FlaskIcon } from "@phosphor-icons/react/Flask";
import { RocketLaunchIcon } from "@phosphor-icons/react/RocketLaunch";
import { LightbulbIcon } from "@phosphor-icons/react/Lightbulb";
import { ImageIcon } from "@phosphor-icons/react/Image";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { TerminalWindowIcon } from "@phosphor-icons/react/TerminalWindow";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/EnvelopeSimple";
import { ChatsCircleIcon } from "@phosphor-icons/react/ChatsCircle";
import { PhoneIcon } from "@phosphor-icons/react/Phone";
import { PresentationChartIcon } from "@phosphor-icons/react/PresentationChart";
import { ChartLineUpIcon } from "@phosphor-icons/react/ChartLineUp";
import { ChartBarIcon } from "@phosphor-icons/react/ChartBar";
import { ChartPieSliceIcon } from "@phosphor-icons/react/ChartPieSlice";
import { TargetIcon } from "@phosphor-icons/react/Target";
import { KanbanIcon } from "@phosphor-icons/react/Kanban";
import { ListChecksIcon } from "@phosphor-icons/react/ListChecks";
import { CheckSquareIcon } from "@phosphor-icons/react/CheckSquare";
import { ClipboardTextIcon } from "@phosphor-icons/react/ClipboardText";
import { NotePencilIcon } from "@phosphor-icons/react/NotePencil";
import { NotebookIcon } from "@phosphor-icons/react/Notebook";
import { FileTextIcon } from "@phosphor-icons/react/FileText";
import { FilesIcon } from "@phosphor-icons/react/Files";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { ArchiveIcon } from "@phosphor-icons/react/Archive";
import { TrayIcon } from "@phosphor-icons/react/Tray";
import { PrinterIcon } from "@phosphor-icons/react/Printer";
import { HandshakeIcon } from "@phosphor-icons/react/Handshake";
import { MegaphoneIcon } from "@phosphor-icons/react/Megaphone";
import { StorefrontIcon } from "@phosphor-icons/react/Storefront";
import { BuildingsIcon } from "@phosphor-icons/react/Buildings";
import { IdentificationCardIcon } from "@phosphor-icons/react/IdentificationCard";
import { UserPlusIcon } from "@phosphor-icons/react/UserPlus";
import { UsersIcon } from "@phosphor-icons/react/Users";
import { GavelIcon } from "@phosphor-icons/react/Gavel";
import { ScalesIcon } from "@phosphor-icons/react/Scales";
import { ShieldCheckIcon } from "@phosphor-icons/react/ShieldCheck";
import { LockIcon } from "@phosphor-icons/react/Lock";
import { KeyIcon } from "@phosphor-icons/react/Key";
import { WrenchIcon } from "@phosphor-icons/react/Wrench";
import { GearIcon } from "@phosphor-icons/react/Gear";
import { HammerIcon } from "@phosphor-icons/react/Hammer";
import { ToolboxIcon } from "@phosphor-icons/react/Toolbox";
import { BugIcon } from "@phosphor-icons/react/Bug";
import { GitBranchIcon } from "@phosphor-icons/react/GitBranch";
import { DatabaseIcon } from "@phosphor-icons/react/Database";
import { CloudIcon } from "@phosphor-icons/react/Cloud";
import { CpuIcon } from "@phosphor-icons/react/Cpu";
import { DesktopIcon } from "@phosphor-icons/react/Desktop";
import { LaptopIcon } from "@phosphor-icons/react/Laptop";
import { DeviceMobileIcon } from "@phosphor-icons/react/DeviceMobile";
import { RobotIcon } from "@phosphor-icons/react/Robot";
import { SparkleIcon } from "@phosphor-icons/react/Sparkle";
import { MagicWandIcon } from "@phosphor-icons/react/MagicWand";
import { PuzzlePieceIcon } from "@phosphor-icons/react/PuzzlePiece";
import { PlugIcon } from "@phosphor-icons/react/Plug";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { LinkIcon } from "@phosphor-icons/react/Link";
import { BrowserIcon } from "@phosphor-icons/react/Browser";
import { NewspaperIcon } from "@phosphor-icons/react/Newspaper";
import { ArticleIcon } from "@phosphor-icons/react/Article";
import { PenNibIcon } from "@phosphor-icons/react/PenNib";
import { QuotesIcon } from "@phosphor-icons/react/Quotes";
import { TranslateIcon } from "@phosphor-icons/react/Translate";
import { MicrophoneIcon } from "@phosphor-icons/react/Microphone";
import { HeadphonesIcon } from "@phosphor-icons/react/Headphones";
import { VideoCameraIcon } from "@phosphor-icons/react/VideoCamera";
import { CurrencyDollarIcon } from "@phosphor-icons/react/CurrencyDollar";
import { MoneyIcon } from "@phosphor-icons/react/Money";
import { WalletIcon } from "@phosphor-icons/react/Wallet";
import { CreditCardIcon } from "@phosphor-icons/react/CreditCard";
import { BankIcon } from "@phosphor-icons/react/Bank";
import { PiggyBankIcon } from "@phosphor-icons/react/PiggyBank";
import { CoinsIcon } from "@phosphor-icons/react/Coins";
import { ReceiptIcon } from "@phosphor-icons/react/Receipt";
import { CalculatorIcon } from "@phosphor-icons/react/Calculator";
import { InvoiceIcon } from "@phosphor-icons/react/Invoice";
import { ShoppingCartIcon } from "@phosphor-icons/react/ShoppingCart";
import { ShoppingBagIcon } from "@phosphor-icons/react/ShoppingBag";
import { TagIcon } from "@phosphor-icons/react/Tag";
import { PackageIcon } from "@phosphor-icons/react/Package";
import { TruckIcon } from "@phosphor-icons/react/Truck";
import { TrendUpIcon } from "@phosphor-icons/react/TrendUp";
import { MapTrifoldIcon } from "@phosphor-icons/react/MapTrifold";
import { MapPinIcon } from "@phosphor-icons/react/MapPin";
import { CompassIcon } from "@phosphor-icons/react/Compass";
import { SuitcaseRollingIcon } from "@phosphor-icons/react/SuitcaseRolling";
import { AirplaneTiltIcon } from "@phosphor-icons/react/AirplaneTilt";
import { TrainIcon } from "@phosphor-icons/react/Train";
import { BusIcon } from "@phosphor-icons/react/Bus";
import { BoatIcon } from "@phosphor-icons/react/Boat";
import { SailboatIcon } from "@phosphor-icons/react/Sailboat";
import { TentIcon } from "@phosphor-icons/react/Tent";
import { CampfireIcon } from "@phosphor-icons/react/Campfire";
import { IslandIcon } from "@phosphor-icons/react/Island";
import { ParkIcon } from "@phosphor-icons/react/Park";
import { CityIcon } from "@phosphor-icons/react/City";
import { BedIcon } from "@phosphor-icons/react/Bed";
import { BuildingApartmentIcon } from "@phosphor-icons/react/BuildingApartment";
import { HouseLineIcon } from "@phosphor-icons/react/HouseLine";
import { PizzaIcon } from "@phosphor-icons/react/Pizza";
import { HamburgerIcon } from "@phosphor-icons/react/Hamburger";
import { CarrotIcon } from "@phosphor-icons/react/Carrot";
import { OrangeSliceIcon } from "@phosphor-icons/react/OrangeSlice";
import { CakeIcon } from "@phosphor-icons/react/Cake";
import { CookieIcon } from "@phosphor-icons/react/Cookie";
import { BreadIcon } from "@phosphor-icons/react/Bread";
import { WineIcon } from "@phosphor-icons/react/Wine";
import { BeerSteinIcon } from "@phosphor-icons/react/BeerStein";
import { MartiniIcon } from "@phosphor-icons/react/Martini";
import { BowlFoodIcon } from "@phosphor-icons/react/BowlFood";
import { EggIcon } from "@phosphor-icons/react/Egg";
import { FirstAidKitIcon } from "@phosphor-icons/react/FirstAidKit";
import { HeartbeatIcon } from "@phosphor-icons/react/Heartbeat";
import { PillIcon } from "@phosphor-icons/react/Pill";
import { StethoscopeIcon } from "@phosphor-icons/react/Stethoscope";
import { ToothIcon } from "@phosphor-icons/react/Tooth";
import { BrainIcon } from "@phosphor-icons/react/Brain";
import { HandHeartIcon } from "@phosphor-icons/react/HandHeart";
import { PersonSimpleTaiChiIcon } from "@phosphor-icons/react/PersonSimpleTaiChi";
import { DropIcon } from "@phosphor-icons/react/Drop";
import { BandaidsIcon } from "@phosphor-icons/react/Bandaids";
import { BookOpenIcon } from "@phosphor-icons/react/BookOpen";
import { BooksIcon } from "@phosphor-icons/react/Books";
import { BookBookmarkIcon } from "@phosphor-icons/react/BookBookmark";
import { BookmarkSimpleIcon } from "@phosphor-icons/react/BookmarkSimple";
import { GraduationCapIcon } from "@phosphor-icons/react/GraduationCap";
import { StudentIcon } from "@phosphor-icons/react/Student";
import { ChalkboardTeacherIcon } from "@phosphor-icons/react/ChalkboardTeacher";
import { ExamIcon } from "@phosphor-icons/react/Exam";
import { CertificateIcon } from "@phosphor-icons/react/Certificate";
import { AtomIcon } from "@phosphor-icons/react/Atom";
import { DnaIcon } from "@phosphor-icons/react/Dna";
import { MicroscopeIcon } from "@phosphor-icons/react/Microscope";
import { GlobeHemisphereWestIcon } from "@phosphor-icons/react/GlobeHemisphereWest";
import { MathOperationsIcon } from "@phosphor-icons/react/MathOperations";
import { PencilRulerIcon } from "@phosphor-icons/react/PencilRuler";
import { PenIcon } from "@phosphor-icons/react/Pen";
import { PaintBucketIcon } from "@phosphor-icons/react/PaintBucket";
import { ScissorsIcon } from "@phosphor-icons/react/Scissors";
import { NeedleIcon } from "@phosphor-icons/react/Needle";
import { GuitarIcon } from "@phosphor-icons/react/Guitar";
import { PianoKeysIcon } from "@phosphor-icons/react/PianoKeys";
import { MicrophoneStageIcon } from "@phosphor-icons/react/MicrophoneStage";
import { FilmStripIcon } from "@phosphor-icons/react/FilmStrip";
import { ApertureIcon } from "@phosphor-icons/react/Aperture";
import { FrameCornersIcon } from "@phosphor-icons/react/FrameCorners";
import { ShapesIcon } from "@phosphor-icons/react/Shapes";
import { CubeIcon } from "@phosphor-icons/react/Cube";
import { SketchLogoIcon } from "@phosphor-icons/react/SketchLogo";
import { FigmaLogoIcon } from "@phosphor-icons/react/FigmaLogo";
import { GameControllerIcon } from "@phosphor-icons/react/GameController";
import { DiceFiveIcon } from "@phosphor-icons/react/DiceFive";
import { CrownIcon } from "@phosphor-icons/react/Crown";
import { TrophyIcon } from "@phosphor-icons/react/Trophy";
import { MedalIcon } from "@phosphor-icons/react/Medal";
import { ConfettiIcon } from "@phosphor-icons/react/Confetti";
import { BalloonIcon } from "@phosphor-icons/react/Balloon";
import { TicketIcon } from "@phosphor-icons/react/Ticket";
import { MaskHappyIcon } from "@phosphor-icons/react/MaskHappy";
import { CouchIcon } from "@phosphor-icons/react/Couch";
import { ArmchairIcon } from "@phosphor-icons/react/Armchair";
import { LampIcon } from "@phosphor-icons/react/Lamp";
import { BroomIcon } from "@phosphor-icons/react/Broom";
import { WashingMachineIcon } from "@phosphor-icons/react/WashingMachine";
import { ShowerIcon } from "@phosphor-icons/react/Shower";
import { ToiletPaperIcon } from "@phosphor-icons/react/ToiletPaper";
import { DoorIcon } from "@phosphor-icons/react/Door";
import { GarageIcon } from "@phosphor-icons/react/Garage";
import { LightningIcon } from "@phosphor-icons/react/Lightning";
import { FireIcon } from "@phosphor-icons/react/Fire";
import { SnowflakeIcon } from "@phosphor-icons/react/Snowflake";
import { CloudRainIcon } from "@phosphor-icons/react/CloudRain";
import { ThermometerIcon } from "@phosphor-icons/react/Thermometer";
import { TShirtIcon } from "@phosphor-icons/react/TShirt";
import { DressIcon } from "@phosphor-icons/react/Dress";
import { SneakerIcon } from "@phosphor-icons/react/Sneaker";
import { WatchIcon } from "@phosphor-icons/react/Watch";
import { EyeglassesIcon } from "@phosphor-icons/react/Eyeglasses";
import { BabyCarriageIcon } from "@phosphor-icons/react/BabyCarriage";
import { ChurchIcon } from "@phosphor-icons/react/Church";
import { HandsPrayingIcon } from "@phosphor-icons/react/HandsPraying";
import { FlagIcon } from "@phosphor-icons/react/Flag";
import { BellIcon } from "@phosphor-icons/react/Bell";
import { InfoIcon } from "@phosphor-icons/react/Info";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { XCircleIcon } from "@phosphor-icons/react/XCircle";
import { HashIcon } from "@phosphor-icons/react/Hash";
import { AtIcon } from "@phosphor-icons/react/At";
import { AsteriskIcon } from "@phosphor-icons/react/Asterisk";
import { InfinityIcon } from "@phosphor-icons/react/Infinity";
import { HourglassIcon } from "@phosphor-icons/react/Hourglass";
import { LightningAIcon } from "@phosphor-icons/react/LightningA";
import { AnchorIcon } from "@phosphor-icons/react/Anchor";
import { FingerprintIcon } from "@phosphor-icons/react/Fingerprint";
import { EyeIcon } from "@phosphor-icons/react/Eye";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { SunHorizonIcon } from "@phosphor-icons/react/SunHorizon";
import { RainbowIcon } from "@phosphor-icons/react/Rainbow";
import { PeaceIcon } from "@phosphor-icons/react/Peace";
import { YinYangIcon } from "@phosphor-icons/react/YinYang";
import { CircleIcon } from "@phosphor-icons/react/Circle";
import { SquareIcon } from "@phosphor-icons/react/Square";
import { TriangleIcon } from "@phosphor-icons/react/Triangle";
import { DiamondIcon } from "@phosphor-icons/react/Diamond";
import { HexagonIcon } from "@phosphor-icons/react/Hexagon";
import { CardsThreeIcon } from "@phosphor-icons/react/CardsThree";
import { StackIcon } from "@phosphor-icons/react/Stack";
import { SquaresFourIcon } from "@phosphor-icons/react/SquaresFour";

/** One icon a project can wear: its Phosphor name, its drawing, and the words a search finds it by. */
export interface ProjectIcon extends ProjectIconEntry {
  Icon: Icon;
}

/** Each icon's drawing, by its name; the set's names are `@instrument-org/shared`'s. */
const DRAWINGS = {
  house: HouseIcon,
  sun: SunIcon,
  "moon-stars": MoonStarsIcon,
  coffee: CoffeeIcon,
  heart: HeartIcon,
  star: StarIcon,
  smiley: SmileyIcon,
  leaf: LeafIcon,
  plant: PlantIcon,
  flower: FlowerIcon,
  tree: TreeIcon,
  mountains: MountainsIcon,
  airplane: AirplaneIcon,
  car: CarIcon,
  bicycle: BicycleIcon,
  barbell: BarbellIcon,
  "person-simple-run": PersonSimpleRunIcon,
  basketball: BasketballIcon,
  "soccer-ball": SoccerBallIcon,
  "music-notes": MusicNotesIcon,
  "film-slate": FilmSlateIcon,
  camera: CameraIcon,
  palette: PaletteIcon,
  "pencil-simple": PencilSimpleIcon,
  "paint-brush": PaintBrushIcon,
  "cooking-pot": CookingPotIcon,
  "fork-knife": ForkKnifeIcon,
  gift: GiftIcon,
  calendar: CalendarIcon,
  alarm: AlarmIcon,
  clock: ClockIcon,
  umbrella: UmbrellaIcon,
  dog: DogIcon,
  cat: CatIcon,
  bird: BirdIcon,
  fish: FishIcon,
  "paw-print": PawPrintIcon,
  baby: BabyIcon,
  "users-three": UsersThreeIcon,
  user: UserIcon,
  briefcase: BriefcaseIcon,
  flask: FlaskIcon,
  "rocket-launch": RocketLaunchIcon,
  lightbulb: LightbulbIcon,
  image: ImageIcon,
  code: CodeIcon,
  "terminal-window": TerminalWindowIcon,
  "envelope-simple": EnvelopeSimpleIcon,
  "chats-circle": ChatsCircleIcon,
  phone: PhoneIcon,
  "presentation-chart": PresentationChartIcon,
  "chart-line-up": ChartLineUpIcon,
  "chart-bar": ChartBarIcon,
  "chart-pie-slice": ChartPieSliceIcon,
  target: TargetIcon,
  kanban: KanbanIcon,
  "list-checks": ListChecksIcon,
  "check-square": CheckSquareIcon,
  "clipboard-text": ClipboardTextIcon,
  "note-pencil": NotePencilIcon,
  notebook: NotebookIcon,
  "file-text": FileTextIcon,
  files: FilesIcon,
  "folder-simple": FolderSimpleIcon,
  archive: ArchiveIcon,
  tray: TrayIcon,
  printer: PrinterIcon,
  handshake: HandshakeIcon,
  megaphone: MegaphoneIcon,
  storefront: StorefrontIcon,
  buildings: BuildingsIcon,
  "identification-card": IdentificationCardIcon,
  "user-plus": UserPlusIcon,
  users: UsersIcon,
  gavel: GavelIcon,
  scales: ScalesIcon,
  "shield-check": ShieldCheckIcon,
  lock: LockIcon,
  key: KeyIcon,
  wrench: WrenchIcon,
  gear: GearIcon,
  hammer: HammerIcon,
  toolbox: ToolboxIcon,
  bug: BugIcon,
  "git-branch": GitBranchIcon,
  database: DatabaseIcon,
  cloud: CloudIcon,
  cpu: CpuIcon,
  desktop: DesktopIcon,
  laptop: LaptopIcon,
  "device-mobile": DeviceMobileIcon,
  robot: RobotIcon,
  sparkle: SparkleIcon,
  "magic-wand": MagicWandIcon,
  "puzzle-piece": PuzzlePieceIcon,
  plug: PlugIcon,
  globe: GlobeIcon,
  link: LinkIcon,
  browser: BrowserIcon,
  newspaper: NewspaperIcon,
  article: ArticleIcon,
  "pen-nib": PenNibIcon,
  quotes: QuotesIcon,
  translate: TranslateIcon,
  microphone: MicrophoneIcon,
  headphones: HeadphonesIcon,
  "video-camera": VideoCameraIcon,
  "currency-dollar": CurrencyDollarIcon,
  money: MoneyIcon,
  wallet: WalletIcon,
  "credit-card": CreditCardIcon,
  bank: BankIcon,
  "piggy-bank": PiggyBankIcon,
  coins: CoinsIcon,
  receipt: ReceiptIcon,
  calculator: CalculatorIcon,
  invoice: InvoiceIcon,
  "shopping-cart": ShoppingCartIcon,
  "shopping-bag": ShoppingBagIcon,
  tag: TagIcon,
  package: PackageIcon,
  truck: TruckIcon,
  "trend-up": TrendUpIcon,
  "map-trifold": MapTrifoldIcon,
  "map-pin": MapPinIcon,
  compass: CompassIcon,
  "suitcase-rolling": SuitcaseRollingIcon,
  "airplane-tilt": AirplaneTiltIcon,
  train: TrainIcon,
  bus: BusIcon,
  boat: BoatIcon,
  sailboat: SailboatIcon,
  tent: TentIcon,
  campfire: CampfireIcon,
  island: IslandIcon,
  park: ParkIcon,
  city: CityIcon,
  bed: BedIcon,
  "building-apartment": BuildingApartmentIcon,
  "house-line": HouseLineIcon,
  pizza: PizzaIcon,
  hamburger: HamburgerIcon,
  carrot: CarrotIcon,
  "orange-slice": OrangeSliceIcon,
  cake: CakeIcon,
  cookie: CookieIcon,
  bread: BreadIcon,
  wine: WineIcon,
  "beer-stein": BeerSteinIcon,
  martini: MartiniIcon,
  "bowl-food": BowlFoodIcon,
  egg: EggIcon,
  "first-aid-kit": FirstAidKitIcon,
  heartbeat: HeartbeatIcon,
  pill: PillIcon,
  stethoscope: StethoscopeIcon,
  tooth: ToothIcon,
  brain: BrainIcon,
  "hand-heart": HandHeartIcon,
  "person-simple-tai-chi": PersonSimpleTaiChiIcon,
  drop: DropIcon,
  bandaids: BandaidsIcon,
  "book-open": BookOpenIcon,
  books: BooksIcon,
  "book-bookmark": BookBookmarkIcon,
  "bookmark-simple": BookmarkSimpleIcon,
  "graduation-cap": GraduationCapIcon,
  student: StudentIcon,
  "chalkboard-teacher": ChalkboardTeacherIcon,
  exam: ExamIcon,
  certificate: CertificateIcon,
  atom: AtomIcon,
  dna: DnaIcon,
  microscope: MicroscopeIcon,
  "globe-hemisphere-west": GlobeHemisphereWestIcon,
  "math-operations": MathOperationsIcon,
  "pencil-ruler": PencilRulerIcon,
  pen: PenIcon,
  "paint-bucket": PaintBucketIcon,
  scissors: ScissorsIcon,
  needle: NeedleIcon,
  guitar: GuitarIcon,
  "piano-keys": PianoKeysIcon,
  "microphone-stage": MicrophoneStageIcon,
  "film-strip": FilmStripIcon,
  aperture: ApertureIcon,
  "frame-corners": FrameCornersIcon,
  shapes: ShapesIcon,
  cube: CubeIcon,
  "sketch-logo": SketchLogoIcon,
  "figma-logo": FigmaLogoIcon,
  "game-controller": GameControllerIcon,
  "dice-five": DiceFiveIcon,
  crown: CrownIcon,
  trophy: TrophyIcon,
  medal: MedalIcon,
  confetti: ConfettiIcon,
  balloon: BalloonIcon,
  ticket: TicketIcon,
  "mask-happy": MaskHappyIcon,
  couch: CouchIcon,
  armchair: ArmchairIcon,
  lamp: LampIcon,
  broom: BroomIcon,
  "washing-machine": WashingMachineIcon,
  shower: ShowerIcon,
  "toilet-paper": ToiletPaperIcon,
  door: DoorIcon,
  garage: GarageIcon,
  lightning: LightningIcon,
  fire: FireIcon,
  snowflake: SnowflakeIcon,
  "cloud-rain": CloudRainIcon,
  thermometer: ThermometerIcon,
  "t-shirt": TShirtIcon,
  dress: DressIcon,
  sneaker: SneakerIcon,
  watch: WatchIcon,
  eyeglasses: EyeglassesIcon,
  "baby-carriage": BabyCarriageIcon,
  church: ChurchIcon,
  "hands-praying": HandsPrayingIcon,
  flag: FlagIcon,
  bell: BellIcon,
  info: InfoIcon,
  question: QuestionIcon,
  warning: WarningIcon,
  "check-circle": CheckCircleIcon,
  "x-circle": XCircleIcon,
  hash: HashIcon,
  at: AtIcon,
  asterisk: AsteriskIcon,
  infinity: InfinityIcon,
  hourglass: HourglassIcon,
  "lightning-a": LightningAIcon,
  anchor: AnchorIcon,
  fingerprint: FingerprintIcon,
  eye: EyeIcon,
  "magnifying-glass": MagnifyingGlassIcon,
  "sun-horizon": SunHorizonIcon,
  rainbow: RainbowIcon,
  peace: PeaceIcon,
  "yin-yang": YinYangIcon,
  circle: CircleIcon,
  square: SquareIcon,
  triangle: TriangleIcon,
  diamond: DiamondIcon,
  hexagon: HexagonIcon,
  "cards-three": CardsThreeIcon,
  stack: StackIcon,
  "squares-four": SquaresFourIcon,
} satisfies Record<ProjectIconName, Icon>;

function withDrawing(icon: ProjectIconEntry): ProjectIcon {
  return { ...icon, Icon: DRAWINGS[icon.name] };
}

/** The set in the picker's order, a heading over each group. */
export const PROJECT_ICON_GROUPS: readonly {
  icons: readonly ProjectIcon[];
  label: string;
}[] = SHARED_GROUPS.map(({ icons, label }) => ({
  icons: icons.map(withDrawing),
  label,
}));

const BY_NAME: ReadonlyMap<string, ProjectIcon> = new Map(
  PROJECT_ICON_GROUPS.flatMap(({ icons }) =>
    icons.map((icon) => [icon.name, icon] as const),
  ),
);

/** The icon a project's file names, or nothing for a name outside this build's set. */
export function projectIcon(name: string | undefined): ProjectIcon | undefined {
  return name === undefined ? undefined : BY_NAME.get(name);
}

/**
 * The icons a search finds, best fit first: every word typed has to match
 * the start of one of an icon's words, so the list narrows as it is typed.
 */
export function searchProjectIcons(query: string): ProjectIcon[] {
  return searchShared(query).map(withDrawing);
}

/**
 * Icons that fit a project's name, best first and at most `limit`: whole
 * words before starts of words, the set's own order breaking ties.
 */
export function suggestProjectIcons(name: string, limit = 8): ProjectIcon[] {
  return suggestShared(name, limit).map(withDrawing);
}
