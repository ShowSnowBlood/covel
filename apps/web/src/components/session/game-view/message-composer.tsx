import { Send, Square } from "lucide-react";
import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
import type { TFunction } from "i18next";
import type { SessionRecord } from "@/services/api.js";
import { Button } from "@/components/ui/button.js";

interface MessageComposerProps {
  t: TFunction;
  session: SessionRecord;
  executing: boolean;
  inputValue: string;
  composerBlocked: boolean;
  composerDisabled: boolean;
  /** The "begin adventure" hero is still waiting to be clicked. */
  awaitingBegin: boolean;
  onInputValueChange: Dispatch<SetStateAction<string>>;
  onSubmit: () => void;
  onAbort?: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

export function MessageComposer({
  t,
  session,
  executing,
  inputValue,
  composerBlocked,
  composerDisabled,
  awaitingBegin,
  onInputValueChange,
  onSubmit,
  onAbort,
  onKeyDown,
}: MessageComposerProps) {
  const isPlaying = session.status === "active" && session.turnCount > 0;
  const isEnded = session.status === "ended";

  return (
    <div
      data-testid="game-composer"
      data-executing={executing}
      data-blocked={composerBlocked}
      className="border-t border-border/80 shrink-0 px-2.5 sm:px-4 py-2.5 sm:py-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-card/75 backdrop-blur-xl"
    >
      {isEnded ? (
        <p className="ui-empty-copy mx-auto text-center text-xs sm:text-sm text-muted-foreground">
          {t("session.ended", "This session has ended.")}
        </p>
      ) : (
        <div className="ui-composer-frame mx-auto">
          <div className="flex items-center gap-1.5 rounded-2xl border border-border/80 bg-background/60 p-1 backdrop-blur-md focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-all shadow-xs">
            <input
              data-testid="game-composer-input"
              type="text"
              value={inputValue}
              onChange={(e) => onInputValueChange(e.target.value)}
              onKeyDown={onKeyDown}
              aria-label={t(
                "session.inputAriaLabel",
                "Story input — press Enter to send",
              )}
              placeholder={
                composerBlocked
                  ? t("session.composerBlockedPlaceholder")
                  : awaitingBegin
                    ? t("session.composerAwaitingBeginPlaceholder")
                    : executing
                      ? t("session.steerPlaceholder", "Interject mid-turn...")
                      : isPlaying
                        ? t(
                            "session.inputPlaceholder",
                            "Enter action or command...",
                          )
                        : t("session.inputPlaceholderAny", "Send a message...")
              }
              disabled={composerDisabled}
              className="flex-1 min-w-0 px-3.5 py-2 bg-transparent text-xs sm:text-sm outline-none disabled:opacity-50 placeholder:text-muted-foreground text-foreground"
            />

            {executing && onAbort && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                radius="lg"
                onClick={onAbort}
                aria-label={t("session.abortTurn", "Stop the current turn")}
                title={t("session.abortTurn", "Stop the current turn")}
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
              >
                <Square className="w-3.5 h-3.5 animate-pulse text-destructive fill-current" />
              </Button>
            )}

            <Button
              type="button"
              variant={inputValue.trim() ? "default" : "ghost"}
              size="icon-sm"
              radius="lg"
              onClick={onSubmit}
              disabled={composerDisabled || !inputValue.trim()}
              aria-label={
                executing
                  ? t("session.steerSend", "interject")
                  : t("session.inputKbdHint", "send")
              }
              className="shrink-0 transition-all"
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
