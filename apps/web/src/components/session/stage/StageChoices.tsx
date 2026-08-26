/**
 * Choice overlay for stage mode (spec §2 `StageChoices`). Renders only
 * once the dialog has finished revealing (`visible`), merging pending
 * interaction choices with scene-prompts short phrases via `mergeChoices`;
 * the always-present "write your own" entry hands off to the parent,
 * which flips `StageDialog` into its input mode.
 */
import { clsx } from "clsx";
import { useTranslation } from "react-i18next";
import type { ReactElement } from "react";
import {
  mergeChoices,
  type StageChoiceItem,
  type StageInteractionChoice,
} from "./stage-selectors.js";

export interface StageChoicesProps {
  readonly visible: boolean;
  readonly interactionChoices: readonly StageInteractionChoice[];
  readonly promptsNamespace: Readonly<Record<string, unknown>>;
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
  locale,
  onSubmitInteraction,
  onSendMessage,
  onFreeInput,
}: StageChoicesProps): ReactElement | null {
  const { t } = useTranslation();
  if (!visible) return null;

  const { items, twoColumn } = mergeChoices(
    interactionChoices,
    promptsNamespace,
    locale,
  );

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
        className={clsx(
          "pointer-events-auto grid max-h-[46vh] w-full gap-1.5 overflow-y-auto",
          twoColumn ? "max-w-2xl" : "max-w-md",
          twoColumn ? "grid-cols-2" : "grid-cols-1",
        )}
      >
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => handleSelect(item)}
            className="rounded-2xl border border-border/80 bg-card/85 backdrop-blur-xl px-4 py-3 text-left text-xs sm:text-sm font-medium text-foreground shadow-md hover:shadow-xl hover:border-primary/60 hover:bg-card/95 hover:scale-[1.01] active:scale-[0.99] transition-all duration-200"
            style={{ animationDelay: `${index * STAGGER_STEP_MS}ms` }}
          >
            <span className="flex items-center justify-between gap-3">
              <span className="min-w-0 flex-1 leading-snug">{item.label}</span>
              {item.description && (
                <span
                  className={clsx(
                    "shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-mono font-semibold border",
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
          className="rounded-2xl border border-dashed border-border/80 bg-background/60 backdrop-blur-md px-4 py-3 text-left text-xs sm:text-sm text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-card/80 transition-all duration-200 shadow-xs"
          style={{ animationDelay: `${items.length * STAGGER_STEP_MS}ms` }}
        >
          {t("stage.freeInputLabel")}
        </button>
      </div>
    </div>
  );
}
