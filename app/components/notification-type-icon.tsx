import {
  Bell,
  CircleDollarSign,
  GraduationCap,
  MessageCircleQuestion,
  MessageSquareReply,
  Receipt,
  Star,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import {
  isNotificationType,
  type NotificationType,
} from "~/lib/notification-feed";
import { cn } from "~/lib/utils";

type TypeStyle = { icon: LucideIcon; tone: string };

const REFUND_DECIDED: TypeStyle = {
  icon: CircleDollarSign,
  tone: "text-emerald-600 bg-emerald-500/10",
};

const TYPE_STYLES: Record<NotificationType, TypeStyle> = {
  refund_request_approved: REFUND_DECIDED,
  refund_request_declined: REFUND_DECIDED,
  new_refund_request: {
    icon: Receipt,
    tone: "text-amber-600 bg-amber-500/10",
  },
  new_discussion_question: {
    icon: MessageCircleQuestion,
    tone: "text-sky-600 bg-sky-500/10",
  },
  new_discussion_reply: {
    icon: MessageSquareReply,
    tone: "text-sky-600 bg-sky-500/10",
  },
  seat_claimed: { icon: UserPlus, tone: "text-violet-600 bg-violet-500/10" },
  course_rated: { icon: Star, tone: "text-yellow-600 bg-yellow-500/10" },
  new_enrollment: {
    icon: GraduationCap,
    tone: "text-indigo-600 bg-indigo-500/10",
  },
};

const UNKNOWN_TYPE: TypeStyle = {
  icon: Bell,
  tone: "text-muted-foreground bg-muted",
};

export function NotificationTypeIcon({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  const { icon: Icon, tone } = isNotificationType(type)
    ? TYPE_STYLES[type]
    : UNKNOWN_TYPE;

  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full",
        tone,
        className
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}
