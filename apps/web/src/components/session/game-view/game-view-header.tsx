import {
  Clapperboard,
  Clock,
  Code,
  Database,
  KeyRound,
  LayoutTemplate,
  ListTree,
  SlidersHorizontal,
  Trophy,
  Loader2,
  CheckCircle2,
} from "lucide-react";

import type { TFunction } from "i18next";
import { Button } from "@/components/ui/button.js";
import { Toggle } from "@/components/ui/toggle.js";
import type { WorldRecord } from "@/services/api.js";
import { text } from "@/components/world/editor-helpers.js";
import { SessionBreadcrumb } from "../session-breadcrumb.js";
import { ConnectionStatus } from "./connection-status.js";
import { ThemeToggle } from "@/components/theme-toggle.js";
export type GameViewMode = "parsed" | "detailed" | "raw" | "stage";

interface GameViewHeaderProps {
  t: TFunction;
  world: WorldRecord | null;
  executing: boolean;
  viewMode: GameViewMode;
  isLeftCollapsed: boolean;
  isRightCollapsed: boolean;
  onViewModeChange: (mode: GameViewMode) => void;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  onOpenSettings: () => void;
  showSettings?: boolean;
  onOpenSuspensions: () => void;
  onBackToWorldSelect: () => void;
  onResetSession: () => void;
  suspensionsCount: number;
  campaignLevel?: number;
  canCompleteLevel: boolean;
  levelCompleted: boolean;
  completingLevel: boolean;
  onCompleteLevel: () => void;
}

export function GameViewHeader({
  t,
  world,
  executing,
  viewMode,
  isLeftCollapsed,
  isRightCollapsed,
  onViewModeChange,
  onToggleLeftPanel,
  onToggleRightPanel,
  onOpenSettings,
  showSettings = true,
  onOpenSuspensions,
  onBackToWorldSelect,
  onResetSession,
  suspensionsCount,
  campaignLevel,
  canCompleteLevel,
  levelCompleted,
  completingLevel,
  onCompleteLevel,
}: GameViewHeaderProps) {
  return (
    <div className="ui-panel-header px-3 flex justify-between items-center gap-2 z-10">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Button
          variant="ghost"
          size="icon"
          className={`h-7 w-7 shrink-0 border border-border/80 ${!isLeftCollapsed && "bg-accent text-accent-foreground"}`}
          onClick={onToggleLeftPanel}
          aria-label={t("session.toggleStoryPanel")}
          title={t("session.toggleStoryPanel")}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
        </Button>
        <SessionBreadcrumb
          step="game"
          worldName={text(world?.name)}
          onGoWorldSelect={onBackToWorldSelect}
          onGoPrep={onResetSession}
          disabled={executing}
        />
        <span
          className={`ui-chip hidden lg:inline-flex ml-1 text-[10px] ${
            executing
              ? "border-transparent bg-[color-mix(in_oklab,var(--accent-primary)_12%,transparent)] text-[var(--accent-primary)]"
              : "border-transparent bg-[color-mix(in_oklab,var(--accent-success)_14%,transparent)] text-[var(--accent-success)]"
          }`}
          aria-live="polite"
        >
          <span
            className={`w-[5px] h-[5px] rounded-full bg-current ${executing ? "ui-pulse-dot" : ""}`}
          />
          {executing ? t("session.stateStreaming") : t("session.statePlaying")}
        </span>
        <ConnectionStatus />
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <div className="flex items-center border border-border/80 rounded-xl overflow-hidden bg-background/50 backdrop-blur-xs p-0.5 gap-0.5">
          <Toggle
            pressed={viewMode === "parsed"}
            onPressedChange={() => onViewModeChange("parsed")}
            size="sm"
            className="rounded-lg border-0 h-6 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground transition-all"
            aria-label={t("session.viewParsedAria")}
            title={t("session.viewParsed")}
          >
            <LayoutTemplate className="w-3.5 h-3.5" />
          </Toggle>
          <Toggle
            pressed={viewMode === "detailed"}
            onPressedChange={() => onViewModeChange("detailed")}
            size="sm"
            className="hidden sm:inline-flex rounded-lg border-0 h-6 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground transition-all"
            aria-label={t("session.viewDetailedAria")}
            title={t("session.viewDetailed")}
          >
            <ListTree className="w-3.5 h-3.5" />
          </Toggle>
          <Toggle
            pressed={viewMode === "raw"}
            onPressedChange={() => onViewModeChange("raw")}
            size="sm"
            className="hidden sm:inline-flex rounded-lg border-0 h-6 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground transition-all"
            aria-label={t("session.viewRawAria")}
            title={t("session.viewRaw")}
          >
            <Code className="w-3.5 h-3.5" />
          </Toggle>
          <Toggle
            pressed={viewMode === "stage"}
            onPressedChange={() => onViewModeChange("stage")}
            size="sm"
            className="rounded-lg border-0 h-6 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground transition-all"
            aria-label={t("session.viewStageAria")}
            title={t("session.viewStage")}
          >
            <Clapperboard className="w-3.5 h-3.5" />
          </Toggle>
        </div>
        {campaignLevel !== undefined && (
          <Button
            variant={levelCompleted ? "ghost" : "outline"}
            size="sm"
            className="h-7 shrink-0 gap-1.5 px-2 text-[10px] uppercase tracking-[0.12em]"
            onClick={onCompleteLevel}
            disabled={!canCompleteLevel || completingLevel || levelCompleted}
            title={
              levelCompleted
                ? t("session.levelCompleted", "Completed")
                : canCompleteLevel
                  ? t("session.completeLevel", "Complete level")
                  : t(
                      "session.completeLevelHint",
                      "Begin the story before completing this level.",
                    )
            }
          >
            {completingLevel ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : levelCompleted ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <Trophy className="h-3.5 w-3.5" />
            )}
            <span className="hidden xl:inline">
              {levelCompleted
                ? t("session.levelCompleted", "Completed")
                : t("session.completeLevel", "Complete level")}
            </span>
          </Button>
        )}

        <div className="hidden sm:flex items-center">
          <ThemeToggle />
        </div>

        {showSettings && (
          <Button
            variant="ghost"
            size="icon"
            className="hidden sm:inline-flex h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
            onClick={onOpenSettings}
            aria-label={t("nav.settings")}
            title={t("nav.settings")}
          >
            <KeyRound className="w-3.5 h-3.5" />
          </Button>
        )}
        {suspensionsCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 shrink-0 gap-1 text-[var(--accent-warning)] hover:bg-[color-mix(in_oklab,var(--accent-warning)_8%,transparent)]"
            onClick={onOpenSuspensions}
            aria-label={t("session.suspensionsBadge", {
              count: suspensionsCount,
            })}
            title={t("session.suspensionsTitle")}
          >
            <Clock className="w-3.5 h-3.5" />
            <span className="text-[11px] tabular-nums">{suspensionsCount}</span>
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          className={`h-7 w-7 shrink-0 ${!isRightCollapsed && "bg-accent text-accent-foreground"}`}
          onClick={onToggleRightPanel}
          aria-label={t("session.toggleContextPanel")}
          title={t("session.toggleContextPanel")}
        >
          <Database className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
