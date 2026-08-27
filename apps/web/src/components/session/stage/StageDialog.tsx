/**
 * Dialog box for stage mode (spec §2/§3 `StageDialog`). Owns the
 * typewriter state machine and reports "fully read" to the parent via
 * `onAllRead` so it can reveal the choice overlay. Doubles as the
 * free-text input surface once `inputMode` is toggled on — that toggle is
 * controlled by the parent, since the "✎" entry that turns it on lives in
 * `StageChoices`, a sibling component.
 */
import {
  useEffect,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useTypewriter } from "./use-typewriter.js";

export interface StageDialogProps {
  readonly turnId?: string;
  readonly storyText: string;
  readonly streamEnded: boolean;
  readonly speakerName?: string;
  readonly autoPlay: boolean;
  readonly reducedMotion?: boolean;
  /** Skip replaying persisted paragraphs when stage is entered mid-session. */
  readonly revealImmediately?: boolean;
  readonly inputMode: boolean;
  readonly onInputModeChange: (inputMode: boolean) => void;
  /** Fires once when the current turn's text has been fully revealed. */
  readonly onAllRead: () => void;
  readonly onSendMessage: (text: string) => void;
}

/** Auto-play dwell time at a paragraph break before advancing (spec §2). */
const AUTO_PLAY_PAUSE_MS = 1200;

export function StageDialog({
  turnId,
  storyText,
  streamEnded,
  speakerName,
  autoPlay,
  reducedMotion = false,
  revealImmediately = false,
  inputMode,
  onInputModeChange,
  onAllRead,
  onSendMessage,
}: StageDialogProps): ReactElement {
  const { t } = useTranslation();
  const { visible, status, advance, skip } = useTypewriter(
    storyText,
    streamEnded,
    { turnId, reducedMotion, revealImmediately },
  );
  const [draft, setDraft] = useState("");

  useEffect(() => {
    // A hydrated turn may already be `done` on the first committed render.
    // Notify the parent for that state too; only reacting to the transition
    // loses the choice overlay when the parent resets its read flag on mount.
    if (status === "done") onAllRead();
  }, [status, onAllRead]);

  useEffect(() => {
    if (!autoPlay || status !== "pause") return;
    const id = setTimeout(advance, AUTO_PLAY_PAUSE_MS);
    return () => clearTimeout(id);
  }, [autoPlay, status, advance]);

  const submitDraft = () => {
    const text = draft.trim();
    if (!text) return;
    onSendMessage(text);
    setDraft("");
    onInputModeChange(false);
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitDraft();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft("");
      onInputModeChange(false);
    }
  };

  const handleFrameClick = () => {
    if (status === "pause") advance();
    else skip();
  };

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-2.5 pb-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-6 md:px-8 md:pb-8"
      data-testid="stage-dialog"
    >
      <div className="ui-stage-panel pointer-events-auto relative w-full max-w-3xl rounded-2xl border border-border/80 bg-card/90 shadow-2xl backdrop-blur-2xl">
        {inputMode ? (
          <div className="flex flex-col gap-2 p-3.5 sm:p-4">
            <textarea
              autoFocus
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleTextareaKeyDown}
              placeholder={t("stage.inputPlaceholder")}
              className="resize-none bg-transparent text-sm sm:text-base outline-none placeholder:text-muted-foreground text-foreground"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">
                {t("stage.inputSendHint")}
              </span>
              <Button
                size="sm"
                onClick={submitDraft}
                disabled={!draft.trim()}
                className="rounded-xl shadow-xs hover:scale-105 active:scale-95 transition-all"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleFrameClick}
            aria-label={t("stage.advanceLabel")}
            className="flex w-full cursor-pointer flex-col gap-1.5 rounded-2xl p-4 sm:p-5 text-left transition-colors hover:bg-foreground/5"
          >
            {speakerName && (
              <span className="absolute -top-3.5 left-4 sm:left-6 rounded-full border border-primary/50 bg-card/95 backdrop-blur-md px-3.5 py-1 text-xs font-bold text-primary shadow-sm tracking-wide">
                {speakerName}
              </span>
            )}
            <p className="min-h-[3.6em] whitespace-pre-line text-sm sm:text-base leading-relaxed text-foreground/95">
              {visible}
              {status === "pause" && (
                <span
                  className="ui-stage-caret ml-1 inline-block text-primary"
                  aria-hidden="true"
                >
                  ▼
                </span>
              )}
            </p>
          </button>
        )}
      </div>
    </div>
  );
}
