import { FROSTFOX_LEVEL_COUNT, frostFoxLevelForWorld } from "@covel/shared";
import type { TFunction } from "i18next";

import {
  Sparkles,
  KeyRound,
  Cpu,
  Wand2,
  FolderOpen,
  ArrowRight,
  Check,
  LockKeyhole,
} from "lucide-react";

import { Button } from "@/components/ui/button.js";
import { ScrollArea } from "@/components/ui/scroll-area.js";
import type { WorldRecord } from "@/services/api.js";
import { WorldCard } from "@/components/world/world-card.js";
import {
  LevelAccordionGallery,
  type LevelAccordionItem,
} from "@/components/world/level-accordion-gallery.js";
import type { FrostFoxProgressionStatus } from "@/services/api.js";

export type LevelProgressionMode =
  "loading" | "disabled" | "account-required" | "ready" | "error";

export interface WorldListViewProps {
  worlds: WorldRecord[];
  t: TFunction;
  /** Label for the primary configured model slot, if any. */
  primarySlotLabel: string | null;
  /** Count of enabled plugin packages, for the footer chip. */
  enabledPluginCount: number;
  /** World currently being entered (drives per-card busy/dimmed state). */
  enteringWorldId: string | null;
  /** Resolve a storage label for a world (Built-in / Server / Browser …). */
  storageLabel: (world: WorldRecord) => string;
  progressionMode: LevelProgressionMode;
  progression: FrostFoxProgressionStatus | null;
  unlockingLevel: number | null;

  onOpenGenerator: () => void;
  onOpenSettings: () => void;
  onConnectAccount: () => void;

  onEnterWorld: (worldId: string) => void;
  onViewDetails: (e: React.MouseEvent, worldId: string) => void;
  onDeleteWorld: (e: React.MouseEvent, worldId: string) => void;
}

/**
 * The list-mode body of the world-select screen: editorial header, the
 * AI-generate / API-keys action rail, the cover-led world grid, the empty
 * state, and the footer info chips.
 */
export function WorldListView({
  worlds,
  t,
  primarySlotLabel,
  enabledPluginCount,
  enteringWorldId,
  storageLabel,
  progressionMode,
  progression,
  unlockingLevel,

  onOpenGenerator,

  onOpenSettings,
  onConnectAccount,

  onEnterWorld,
  onViewDetails,
  onDeleteWorld,
}: WorldListViewProps) {
  const campaignEnabled = progressionMode !== "disabled";
  const orderedWorlds = campaignEnabled
    ? [...worlds].sort((left, right) => {
        const leftLevel = frostFoxLevelForWorld(left.id);
        const rightLevel = frostFoxLevelForWorld(right.id);
        if (leftLevel !== null && rightLevel !== null)
          return leftLevel - rightLevel;
        if (leftLevel !== null) return -1;
        if (rightLevel !== null) return 1;
        return 0;
      })
    : worlds;
  const completedLevel = progression?.completedLevel ?? 0;
  const unlockedLevel = progression?.unlockedLevel ?? 0;
  const campaignWorlds = campaignEnabled
    ? orderedWorlds.filter((world) => frostFoxLevelForWorld(world.id) !== null)
    : [];
  const freePlayWorlds = campaignEnabled
    ? orderedWorlds.filter((world) => frostFoxLevelForWorld(world.id) === null)
    : orderedWorlds;
  const campaignItems: LevelAccordionItem[] = campaignWorlds.map((world) => {
    const levelNumber = frostFoxLevelForWorld(world.id)!;
    return {
      world,
      levelNumber,
      completed: levelNumber <= completedLevel,
      locked: progressionMode !== "ready" || levelNumber > unlockedLevel,
      unlocking: progressionMode === "ready" && levelNumber === unlockingLevel,
      lockLabel:
        progressionMode === "account-required"
          ? t("session.levelSignIn", "Sign in to unlock")
          : progressionMode === "loading"
            ? t("session.levelProgressLoading", "Loading progress…")
            : progressionMode === "error"
              ? t("session.levelProgressUnavailable", "Progress unavailable")
              : t("session.completePriorLevel", {
                  level: levelNumber - 1,
                  defaultValue: "Clear level {{level}} first",
                }),
      isEntering: enteringWorldId === world.id,
      dimmed: enteringWorldId !== null && enteringWorldId !== world.id,
    };
  });
  const activeCampaignIndex = Math.max(
    campaignItems.findIndex((item) => item.levelNumber === unlockedLevel),
    Math.min(completedLevel, Math.max(campaignItems.length - 1, 0)),
  );

  return (
    <ScrollArea className="w-full h-full">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-10 py-5 md:py-8">
        {/* Editorial header */}
        <header className="grid grid-cols-1 md:grid-cols-12 gap-5 md:gap-8 items-end mb-7 md:mb-9">
          <div className="md:col-span-7">
            <p className="ui-eyebrow text-muted-foreground mb-2.5">
              {t(
                "session.worldsHeaderEyebrow",
                `${worlds.length} worlds available`,
                {
                  count: worlds.length,
                },
              )}
            </p>
            <h1 className="font-display font-bold tracking-tight leading-[0.95] text-[clamp(2.25rem,5.4vw,4.25rem)]">
              {t("session.selectWorld", "Choose a world")}
            </h1>
            <p className="mt-4 text-sm md:text-base text-muted-foreground font-light leading-relaxed max-w-xl">
              {t(
                "session.worldSelectDesc",
                "Each world is a self-contained setting with its own tone, characters, and ruleset.",
              )}
            </p>
          </div>

          {/* Compact action rail keeps creation and setup nearby without pushing worlds down. */}
          <aside className="md:col-span-5 grid grid-cols-2 md:grid-cols-1 lg:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={onOpenGenerator}
              className="group relative min-h-[92px] overflow-hidden rounded-[var(--radius-card)] border border-primary/25 bg-card/80 hover:border-primary/55 transition-all p-3 sm:p-4 text-left"
            >
              <div
                aria-hidden="true"
                className="absolute -right-12 -top-12 h-28 w-28 rounded-full opacity-40 group-hover:opacity-65 transition-opacity"
                style={{
                  background:
                    "radial-gradient(circle, color-mix(in oklab, var(--color-primary) 70%, transparent) 0%, transparent 70%)",
                }}
              />
              <div className="relative">
                <div className="flex items-center gap-2 mb-2">
                  <Wand2 className="w-4 h-4 text-primary" />
                  <span className="ui-eyebrow text-primary">
                    {t("world.aiCreate", "AI generate")}
                  </span>
                </div>
                <p className="font-display text-[13px] sm:text-sm font-semibold leading-snug line-clamp-2">
                  {t(
                    "session.aiCreateTeaser",
                    "Spin up a brand new world from a one-line idea.",
                  )}
                </p>
                <p className="mt-3 text-xs text-primary inline-flex items-center gap-1.5 group-hover:gap-2.5 transition-all font-medium">
                  {t("session.aiCreateAction", "Describe your idea")}
                  <ArrowRight className="w-3.5 h-3.5" />
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={onOpenSettings}
              className="group flex min-h-[92px] items-center justify-between rounded-[var(--radius-card)] border border-border bg-card/70 hover:border-primary/40 hover:bg-muted/30 transition-all p-3 sm:p-4 text-left"
            >
              <div className="flex items-center gap-3 min-w-0">
                <KeyRound className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-[13px] sm:text-sm font-medium leading-snug line-clamp-2">
                    {t("session.configureKeys", "API keys & presets")}
                  </p>
                  <p className="text-[11px] text-muted-foreground/80 truncate">
                    {primarySlotLabel ??
                      t("session.noModelsConfigured", "No model configured")}
                  </p>
                </div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
            </button>
          </aside>
        </header>

        {campaignEnabled && (
          <section
            aria-label={t("session.levelProgress", "Level progress")}
            className="mb-5 overflow-hidden rounded-[var(--radius-card)] border border-border bg-card/72"
          >
            <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <p className="ui-eyebrow text-primary">
                  {t("session.campaignRoute", "Campaign route")}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {progressionMode === "loading"
                    ? t("session.levelProgressLoading", "Loading progress…")
                    : progressionMode === "account-required"
                      ? t(
                          "session.levelAccountRequired",
                          "Sign in to start and save your progress.",
                        )
                      : progressionMode === "error"
                        ? t(
                            "session.levelProgressError",
                            "Progress is unavailable. Try again shortly.",
                          )
                        : completedLevel >= FROSTFOX_LEVEL_COUNT
                          ? t(
                              "session.allLevelsCompleted",
                              "All levels completed.",
                            )
                          : t("session.nextLevelUnlocked", {
                              level: unlockedLevel,
                              defaultValue: "Level {{level}} is unlocked.",
                            })}
                </p>
              </div>
              {progressionMode === "account-required" ? (
                <Button size="sm" onClick={onConnectAccount}>
                  {t("account.loginAction")}
                </Button>
              ) : progressionMode === "ready" ? (
                <p className="ui-meta tabular-nums text-foreground">
                  {t("session.levelProgressCount", {
                    completed: completedLevel,
                    total: FROSTFOX_LEVEL_COUNT,
                    defaultValue: "{{completed}} / {{total}} cleared",
                  })}
                </p>
              ) : null}
            </div>
            <ol className="grid grid-cols-3">
              {Array.from({ length: FROSTFOX_LEVEL_COUNT }, (_, index) => {
                const level = index + 1;
                const completed = level <= completedLevel;
                const available =
                  progressionMode === "ready" && level === unlockedLevel;
                return (
                  <li
                    key={level}
                    className={`flex items-center gap-2.5 border-r border-border px-3 py-3 last:border-r-0 sm:px-5 ${
                      available ? "bg-primary/[0.06]" : ""
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums ${
                        completed
                          ? "border-emerald-500/40 bg-emerald-500/12 text-emerald-600"
                          : available
                            ? "border-primary/50 bg-primary/10 text-primary"
                            : "border-border text-muted-foreground"
                      }`}
                    >
                      {completed ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : level > unlockedLevel ||
                        progressionMode !== "ready" ? (
                        <LockKeyhole className="h-3 w-3" />
                      ) : (
                        level
                      )}
                    </span>
                    <span className="ui-meta hidden text-foreground sm:inline">
                      {t("session.levelNumber", {
                        level,
                        defaultValue: "LEVEL {{level}}",
                      })}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {campaignItems.length > 0 && (
          <section aria-label={t("session.selectWorld", "Choose a world")}>
            <LevelAccordionGallery
              items={campaignItems}
              defaultIndex={activeCampaignIndex}
              t={t}
              onEnter={onEnterWorld}
              onLocked={
                progressionMode === "account-required"
                  ? onConnectAccount
                  : undefined
              }
              onViewDetails={onViewDetails}
              onDelete={onDeleteWorld}
            />
          </section>
        )}

        {freePlayWorlds.length > 0 && (
          <section className={campaignItems.length > 0 ? "mt-8" : ""}>
            {campaignItems.length > 0 && (
              <div className="mb-4 flex items-center gap-3">
                <span className="ui-eyebrow text-muted-foreground">
                  {t("session.otherWorlds", "Other worlds")}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 md:gap-5">
              {freePlayWorlds.map((world, index) => {
                const isEntering = enteringWorldId === world.id;
                return (
                  <WorldCard
                    key={world.id}
                    world={world}
                    index={index}
                    isEntering={isEntering}
                    dimmed={enteringWorldId !== null && !isEntering}
                    storageLabel={storageLabel(world)}
                    t={t}
                    onEnter={onEnterWorld}
                    onViewDetails={onViewDetails}
                    onDelete={onDeleteWorld}
                  />
                );
              })}
            </div>
          </section>
        )}

        {orderedWorlds.length === 0 && (
          <div className="text-center py-16 md:py-24 border-y border-dashed border-[var(--rule-color)]">
            <FolderOpen className="w-10 h-10 mx-auto text-muted-foreground/60" />
            <h2 className="font-display font-bold text-xl mt-5">
              {t("session.worldsEmptyTitle", "No worlds yet")}
            </h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto font-light">
              {t(
                "session.worldsEmptyDesc",
                "Generate a new world with AI, or add a world package under the worlds/ folder.",
              )}
            </p>
            <div className="flex items-center justify-center gap-3 mt-7">
              <Button
                size="sm"
                className="text-xs uppercase tracking-widest"
                onClick={onOpenGenerator}
              >
                <Wand2 className="w-3.5 h-3.5 mr-1.5" />
                {t("world.aiCreate", "AI create")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs uppercase tracking-widest"
                onClick={() =>
                  window.open(
                    "https://github.com/ackness/covel/tree/main/worlds",
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                {t("session.worldsEmptyViewExamples", "View examples")}
              </Button>
            </div>
          </div>
        )}

        {/* Footer info chips */}
        <div className="mt-8 md:mt-10 pt-5 border-t border-border flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          {enabledPluginCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Cpu className="w-3 h-3" />
              {t("session.pluginsLoaded", { count: enabledPluginCount })}
            </span>
          )}
          {primarySlotLabel && (
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" />
              {primarySlotLabel}
            </span>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
