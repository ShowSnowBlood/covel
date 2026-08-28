import { Send, Sparkles, Square, Terminal } from "lucide-react";
import {
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type SetStateAction,
} from "react";
import type { TFunction } from "i18next";
import type { SessionRecord } from "@/services/api.js";
import { Button } from "@/components/ui/button.js";
import { Magnet } from "@/components/reactbits/Magnet.js";
import { cn } from "@/lib/utils.js";

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
}: MessageComposerProps): ReactElement {
  const isPlaying = session.status === "active" && session.turnCount > 0;
  const isEnded = session.status === "ended";
  const hasContent = Boolean(inputValue.trim());
  const isCommand = inputValue.startsWith("/");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  return (
    <div
      data-testid="game-composer"
      data-executing={executing}
      data-blocked={composerBlocked}
      className="border-t border-border/80 shrink-0 px-3 sm:px-4 py-2.5 sm:py-3.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-card/85 backdrop-blur-2xl transition-colors"
    >
      {isEnded ? (
        <p className="ui-empty-copy mx-auto text-center text-xs sm:text-sm text-muted-foreground py-2">
          {t("session.ended", "This session has ended.")}
        </p>
      ) : (
        <div className="ui-composer-frame mx-auto max-w-4xl">
          <div
            ref={containerRef}
            onMouseMove={handleMouseMove}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={cn(
              "group relative flex items-center gap-1.5 rounded-2xl border p-1.5 backdrop-blur-md transition-all duration-300 shadow-sm",
              isFocused
                ? "border-primary/60 bg-background/90 ring-2 ring-primary/20 shadow-[0_0_20px_rgba(var(--accent-primary-rgb,99,102,241),0.12)]"
                : "border-border/80 bg-background/70 hover:border-border hover:bg-background/85",
              composerDisabled && "opacity-60 pointer-events-none",
            )}
          >
            {/* ReactBits cursor spotlight layer */}
            <div
              className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl transition-opacity duration-300"
              style={{
                opacity: isHovered || isFocused ? 1 : 0,
                background: `radial-gradient(240px circle at ${mousePos.x}px ${mousePos.y}px, color-mix(in oklab, var(--accent-primary, #6366f1) 14%, transparent), transparent 75%)`,
              }}
              aria-hidden="true"
            />

            {/* Mode badge */}
            {isCommand ? (
              <span className="relative z-10 ml-1.5 flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-mono font-medium text-primary animate-in fade-in zoom-in-95 duration-150">
                <Terminal className="h-3 w-3" />
                <span className="hidden sm:inline">CMD</span>
              </span>
            ) : (
              <span className="relative z-10 ml-1.5 hidden items-center text-muted-foreground/40 sm:flex">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
            )}

            <input
              data-testid="game-composer-input"
              type="text"
              value={inputValue}
              onChange={(e) => onInputValueChange(e.target.value)}
              onKeyDown={onKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
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
              className="relative z-10 flex-1 min-w-0 px-2.5 sm:px-3 py-2 bg-transparent text-xs sm:text-sm outline-none disabled:opacity-50 placeholder:text-muted-foreground text-foreground selection:bg-primary/25"
            />

            {/* Keyboard shortcut indicator when typing */}
            {hasContent && !executing && (
              <kbd className="relative z-10 hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground/70 bg-muted/60 rounded-md border border-border/40 transition-all animate-in fade-in duration-200">
                ↵
              </kbd>
            )}

            {executing && onAbort && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                radius="lg"
                onClick={onAbort}
                aria-label={t("session.abortTurn", "Stop the current turn")}
                title={t("session.abortTurn", "Stop the current turn")}
                className="relative z-10 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 rounded-xl h-8 w-8 sm:h-9 sm:w-9 transition-all hover:scale-105 active:scale-95"
              >
                <Square className="w-3.5 h-3.5 animate-pulse text-destructive fill-current" />
              </Button>
            )}

            <Magnet
              padding={35}
              magnetStrength={3}
              disabled={composerDisabled || !hasContent}
              className="shrink-0"
            >
              <Button
                type="button"
                variant={hasContent ? "default" : "ghost"}
                size="icon-sm"
                radius="lg"
                onClick={onSubmit}
                disabled={composerDisabled || !hasContent}
                aria-label={
                  executing
                    ? t("session.steerSend", "interject")
                    : t("session.inputKbdHint", "send")
                }
                className={cn(
                  "relative z-10 shrink-0 transition-all duration-200 rounded-xl h-8 w-8 sm:h-9 sm:w-9 shadow-xs",
                  hasContent
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 hover:scale-105 active:scale-95"
                    : "text-muted-foreground/60 hover:text-foreground",
                )}
              >
                <Send className="w-3.5 h-3.5" />
              </Button>
            </Magnet>
          </div>
        </div>
      )}
    </div>
  );
}
