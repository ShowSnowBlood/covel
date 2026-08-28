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
import { Sparkles, Edit3 } from "lucide-react";
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

const STAGGER_STEP_MS = 60;

// Category labels (观察/交涉/行动/追问) arrive as already-localized display text
// with no semantic key attached, so there's nothing to map a fixed color onto.
// Cycle the four `ui-stage-cat-*` hues by item index instead — the goal is only
// visual separation between adjacent choices.
const CATEGORY_HUES = 4;

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
          "pointer-events-auto relative grid max-h-[46vh] w-full gap-2 overflow-y-auto p-1 rounded-2xl",
          twoColumn ? "max-w-2xl" : "max-w-md",
          twoColumn ? "grid-cols-2" : "grid-cols-1",
        )}
      >
        {/* ReactBits ambient spotlight over the choices container */}
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl transition-opacity duration-300 -z-10"
          style={{
            opacity: isHovered ? 1 : 0,
            background: `radial-gradient(320px circle at ${mousePos.x}px ${mousePos.y}px, color-mix(in oklab, var(--accent-primary, #6366f1) 20%, transparent), transparent 80%)`,
          }}
          aria-hidden="true"
        />

        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => handleSelect(item)}
            className="group/choice ui-stage-panel ui-stage-choice-item relative overflow-hidden rounded-xl px-4 py-2.5 text-left text-sm font-medium transition-all duration-200 hover:border-primary hover:bg-card/95 hover:shadow-lg hover:scale-[1.015] active:scale-[0.985]"
            style={{ animationDelay: `${index * STAGGER_STEP_MS}ms` }}
          >
            <span className="flex items-center justify-between gap-3">
              <span className="min-w-0 flex-1 leading-snug text-foreground group-hover/choice:text-primary transition-colors">
                {item.label}
              </span>
              {item.description && (
                <span
                  className={clsx(
                    "ui-stage-cat shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase transition-all shadow-xs",
                    `ui-stage-cat-${index % CATEGORY_HUES}`,
                  )}
                >
                  {item.description}
                </span>
              )}
            </span>
          </button>
        ))}

        <button
          type="button"
          onClick={onFreeInput}
          className="group/free ui-stage-panel ui-stage-choice-item relative overflow-hidden rounded-xl border border-dashed border-border/80 px-4 py-2.5 text-left text-sm text-muted-foreground transition-all duration-200 hover:border-primary/80 hover:text-foreground hover:bg-card/95 hover:shadow-md hover:scale-[1.015] active:scale-[0.985]"
          style={{ animationDelay: `${items.length * STAGGER_STEP_MS}ms` }}
        >
          <span className="flex items-center gap-2">
            <Edit3 className="h-3.5 w-3.5 text-primary/70 group-hover/free:text-primary transition-colors" />
            <span className="flex-1">{t("stage.freeInputLabel")}</span>
            <Sparkles className="h-3 w-3 opacity-0 group-hover/free:opacity-100 text-primary transition-opacity" />
          </span>
        </button>
      </div>
    </div>
  );
}
