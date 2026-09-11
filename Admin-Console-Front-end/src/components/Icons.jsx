import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BatteryMedium,
  Bot,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  Cpu,
  ExternalLink,
  Eye,
  EyeOff,
  Grid2X2,
  House,
  Info,
  KeyRound,
  LockKeyhole,
  Layers3,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
  Terminal,
  Trash2,
  TriangleAlert,
  UploadCloud,
  UserRound,
  Users,
  Video,
  Wifi,
  X,
} from "lucide-react";

export const IconActivity = Activity;
export const IconAlertCircle = CircleAlert;
export const IconAlertTriangle = TriangleAlert;
export const IconArrowRight = ArrowRight;
export const IconArrowUpRight = ArrowUpRight;
export function IconBattery({ level: _level, ...props }) {
  return <BatteryMedium {...props} />;
}
export const IconBuilding = Building2;
export const IconCheck = Check;
export const IconChevronDown = ChevronDown;
export const IconChevronRight = ChevronRight;
export const IconClock = Clock3;
export const IconCopy = Copy;
export const IconCpu = Cpu;
export const IconEdit = Pencil;
export const IconExternalLink = ExternalLink;
export const IconEye = Eye;
export const IconEyeOff = EyeOff;
export const IconGrid = Grid2X2;
export const IconHome = LayoutDashboard;
export const IconInfo = Info;
export const IconKey = KeyRound;
export const IconLock = LockKeyhole;
export const IconLayers = Layers3;
export const IconLogOut = LogOut;
export const IconMenu = Menu;
export const IconPanelLeftClose = PanelLeftClose;
export const IconPanelLeftOpen = PanelLeftOpen;
export const IconPlus = Plus;
export const IconRefresh = RefreshCw;
export const IconRobot = Bot;
export const IconSearch = Search;
export const IconShield = ShieldCheck;
export const IconSliders = SlidersHorizontal;
export const IconSparkles = Sparkles;
export const IconStore = Store;
export const IconTerminal = Terminal;
export const IconTrash = Trash2;
export const IconUpload = UploadCloud;
export const IconUser = UserRound;
export const IconUsers = Users;
export const IconVideo = Video;
export const IconWifi = Wifi;
export const IconX = X;

// Compatibility export for legacy imports; interface icons are all Lucide.
export const IconBase = House;
