/**
 * Choice overlay for stage mode (spec §2 `StageChoices`). Renders only
 * once the dialog has finished revealing (`visible`), merging pending
 * interaction choices with both quick-reply provider shapes via `mergeChoices`;
 * the always-present "write your own" entry hands off to the parent, which
 * flips `StageDialog` into its input mode.
 */
import { clsx } from "clsx";
import { useTranslation } from "react-i18next";
import { useRef, useState, type MouseEvent, type ReactElement } from "react";
import {
  Sparkles,
  Edit3,
  Eye,
  MessageSquare,
  Zap,
  HelpCircle,
  ChevronRight,
} from "lucide-react";
import {
  mergeChoices,
  type StageChoiceItem,
  type StageInteractionChoice,
} from "./stage-selectors.js";

export interface StageChoicesProps {
  readonly visible: boolean;
  readonly interactionChoices: readonly StageInteractionChoice[];
  readonly promptsNamespace: Readonly<Record<string, unknown>>;
  readonly additionalPromptNamespaces?: readonly Readonly<
    Record<string, unknown>
  >[];
  readonly locale: string;
  readonly onSubmitInteraction?: (
    blockId: string,
    turnId: string,
    interactionId: string,
    type: "form" | "choice" | "confirmation",
    values: Record<string, unknown>,
    submitBehavior?: { echoFilledNarrative?: boolean },
  ) => Promise<void>;
  readonly onSendMessage: (text: string) => void;
  readonly onFreeInput: () => void;
}

const STAGGER_STEP_MS = 50;

interface CategoryStyle {
  barColor: string;
  badgeClass: string;
  Icon: React.ComponentType<{ className?: string }>;
}

function getCategoryStyle(description: string | undefined, index: number): CategoryStyle {
  const desc = (description ?? "").trim().toLowerCase();

  if (
    desc.includes("观察") ||
    desc.includes("look") ||
    desc.includes("observe") ||
    desc.includes("investigate")
  ) {
    return {
      barColor: "bg-sky-500",
      badgeClass: "border-sky-500/30 bg-sky-500/15 text-sky-600 dark:text-sky-300",
      Icon: Eye,
    };
  }

  if (
    desc.includes("交涉") ||
    desc.includes("对话") ||
    desc.includes("talk") ||
    desc.includes("persuade") ||
    desc.includes("speak")
  ) {
    return {
      barColor: "bg-emerald-500",
      badgeClass: "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
      Icon: MessageSquare,
    };
  }

  if (
    desc.includes("行动") ||
    desc.includes("战斗") ||
    desc.includes("act") ||
    desc.includes("attack") ||
    desc.includes("fight")
  ) {
    return {
      barColor: "bg-amber-500",
      badgeClass: "border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-300",
      Icon: Zap,
    };
  }

  if (
    desc.includes("追问") ||
    desc.includes("思考") ||
    desc.includes("question") ||
    desc.includes("ask") ||
    desc.includes("think")
  ) {
    return {
      barColor: "bg-violet-500",
      badgeClass: "border-violet-500/30 bg-violet-500/15 text-violet-600 dark:text-violet-300",
      Icon: HelpCircle,
    };
  }

  // Fallback cycle based on index
  const hues: CategoryStyle[] = [
    {
      barColor: "bg-sky-500",
      badgeClass: "border-sky-500/30 bg-sky-500/15 text-sky-600 dark:text-sky-300",
      Icon: Eye,
    },
    {
      barColor: "bg-emerald-500",
      badgeClass: "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
      Icon: MessageSquare,
    },
    {
      barColor: "bg-amber-500",
      badgeClass: "border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-300",
      Icon: Zap,
    },
    {
      barColor: "bg-violet-500",
      badgeClass: "border-violet-500/30 bg-violet-500/15 text-violet-600 dark:text-violet-300",
      Icon: HelpCircle,
    },
  ];

  return hues[index % hues.length]!;
}
export function StageChoices({
  visible,
  interactionChoices,
  promptsNamespace,
  additionalPromptNamespaces = [],
  locale,
  onSubmitInteraction,
  onSendMessage,
  onFreeInput,
}: StageChoicesProps): ReactElement | null {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  if (!visible) return null;

  const { items, twoColumn } = mergeChoices(
    interactionChoices,
    promptsNamespace,
    locale,
    additionalPromptNamespaces,
  );

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const handleSelect = (item: StageChoiceItem) => {
    if (item.kind === "interaction") {
      void onSubmitInteraction?.(
        item.blockId,
        item.turnId,
        item.interactionId,
        "choice",
        { selectedId: item.choiceId, selectedLabel: item.label },
        item.submitBehavior,
      );
      return;
    }
    onSendMessage(item.label);
  };

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-[8rem] z-40 flex justify-center px-4 md:bottom-40"
      data-testid="stage-choices"
    >
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={clsx(
          "pointer-events-auto relative grid max-h-[46vh] w-full gap-2 overflow-y-auto p-1.5 rounded-3xl",
          twoColumn ? "max-w-2xl" : "max-w-md",
          twoColumn ? "grid-cols-2" : "grid-cols-1",
        )}
      >
        {/* ReactBits ambient spotlight over the choices container */}
        <div
          className="pointer-events-none absolute inset-0 rounded-3xl transition-opacity duration-300 -z-10"
          style={{
            opacity: isHovered ? 1 : 0,
            background: `radial-gradient(360px circle at ${mousePos.x}px ${mousePos.y}px, color-mix(in oklab, var(--accent-primary, #6366f1) 18%, transparent), transparent 75%)`,
          }}
          aria-hidden="true"
        />

        {items.map((item, index) => {
          const style = getCategoryStyle(item.description, index);
          const { Icon } = style;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelect(item)}
              className="group/choice relative flex items-center gap-3 overflow-hidden rounded-2xl border border-border/70 bg-card/90 px-4 py-3 text-left text-sm backdrop-blur-xl transition-all duration-200 hover:scale-[1.015] hover:border-primary/60 hover:bg-card hover:shadow-xl active:scale-[0.985]"
              style={{ animationDelay: `${index * STAGGER_STEP_MS}ms` }}
            >
              {/* Left category accent glowing bar */}
              <div
                className={clsx(
                  "absolute left-0 top-1/2 -translate-y-1/2 h-1/2 w-1 rounded-r-full transition-all duration-300 group-hover/choice:h-4/5",
                  style.barColor,
                )}
              />

              {/* Number / Action index badge */}
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-muted/70 font-mono text-[11px] font-bold text-muted-foreground group-hover/choice:bg-primary/20 group-hover/choice:text-primary transition-colors">
                {index + 1}
              </span>

              {/* Choice label */}
              <span className="min-w-0 flex-1 font-medium leading-snug text-foreground/95 group-hover/choice:text-primary transition-colors">
                {item.label}
              </span>

              {/* Category pill badge */}
              {item.description && (
                <span
                  className={clsx(
                    "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-all shadow-xs",
                    style.badgeClass,
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {item.description}
                </span>
              )}

              {/* Hover arrow indicator */}
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 opacity-0 -translate-x-1 group-hover/choice:opacity-100 group-hover/choice:translate-x-0 group-hover/choice:text-primary transition-all duration-200" />
            </button>
          );
        })}

        <button
          type="button"
          onClick={onFreeInput}
          className="group/free relative flex items-center gap-3 overflow-hidden rounded-2xl border border-dashed border-primary/30 bg-card/75 px-4 py-2.5 text-left text-sm backdrop-blur-xl transition-all duration-200 hover:scale-[1.015] hover:border-primary/80 hover:bg-card/95 hover:shadow-md active:scale-[0.985]"
          style={{ animationDelay: `${items.length * STAGGER_STEP_MS}ms` }}
        >
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover/free:bg-primary group-hover/free:text-primary-foreground transition-colors">
            <Edit3 className="h-3.5 w-3.5" />
          </div>
          <span className="min-w-0 flex-1 font-medium text-foreground/85 group-hover/free:text-foreground transition-colors">
            {t("stage.freeInputLabel")}
          </span>
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary/70 opacity-0 group-hover/free:opacity-100 transition-opacity" />
        </button>
      </div>
    </div>
  );
}
