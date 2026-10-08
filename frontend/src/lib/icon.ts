import type { ComponentType, SVGProps } from 'react'

/** The prop type for a component that takes one of the icons below. */
export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

// One icon per concept, everywhere. Import from here, never from lucide-react directly.
export {
  MessagesSquare as ThreadIcon,
  ListChecks as GuideIcon,
  CircleQuestionMark as QuizIcon,
  ChartLine as ProgressIcon,
  Lightbulb as HintIcon,
  Flame as StreakIcon,
  LogOut as LogOutIcon,
  Copy as CopyIcon,
  Square as StopIcon,
  Send as SendIcon,
  RotateCcw as RetryIcon,
  Plus as NewIcon,
  Pencil as RenameIcon,
  Trash2 as DeleteIcon,
  ArrowLeft as BackIcon,
  ArrowRight as NextIcon,
  Check as DoneIcon,
  X as WrongIcon
} from 'lucide-react'
