import type { TFunction } from "i18next";
import { Cpu, FolderOpen, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { ScrollArea } from "@/components/ui/scroll-area.js";
import type { WorldRecord } from "@/services/api.js";
import { WorldCard } from "@/components/world/world-card.js";
import { ShinyText } from "@/components/reactbits/index.js";

export interface WorldListViewProps {
  worlds: WorldRecord[];
  t: TFunction;
  primarySlotLabel: string | null;
  enabledPluginCount: number;
  enteringWorldId: string | null;
  storageLabel: (world: WorldRecord) => string;
  onOpenGenerator: () => void;
  onEnterWorld: (worldId: string) => void;
  onViewDetails: (e: React.MouseEvent, worldId: string) => void;
  onDeleteWorld: (e: React.MouseEvent, worldId: string) => void;
}

/**
 * World selection stays available for starting a session, but it is a simple
 * free-play catalog. Campaign unlocking belongs to game progression, not this
 * navigation surface, so the stale level-progress interface is intentionally
 * not rendered here.
 */
export function WorldListView({
  worlds,
  t,
  primarySlotLabel,
  enabledPluginCount,
  enteringWorldId,
  storageLabel,
  onOpenGenerator,
  onEnterWorld,
  onViewDetails,
  onDeleteWorld,
}: WorldListViewProps) {
  return (
    <ScrollArea className="w-full h-full">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-10 py-5 md:py-8">
        <header className="mb-8 md:mb-10 text-center max-w-2xl mx-auto">
          <p className="ui-eyebrow text-muted-foreground mb-2.5">
            {t("session.worldsHeaderEyebrow", "{{count}} worlds available", {
              count: worlds.length,
            })}
          </p>
          <h1 className="font-display font-bold tracking-tight leading-[0.95] text-[clamp(2.5rem,6vw,4.5rem)] text-foreground">
            <ShinyText speed={5} shineColor="rgba(255, 255, 255, 0.8)">
              {t("session.selectWorld", "Choose a world")}
            </ShinyText>
          </h1>
          <p className="mt-4 text-sm md:text-base text-muted-foreground font-light leading-relaxed">
            {t(
              "session.worldSelectDesc",
              "Each world is a self-contained setting with its own tone, characters, and ruleset.",
            )}
          </p>
        </header>

        {worlds.length > 0 && (
          <section aria-label={t("session.selectWorld", "Choose a world")}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
              {worlds.map((world, index) => (
                <WorldCard
                  key={world.id}
                  world={world}
                  index={index}
                  isEntering={enteringWorldId === world.id}
                  dimmed={
                    enteringWorldId !== null && enteringWorldId !== world.id
                  }
                  storageLabel={storageLabel(world)}
                  t={t}
                  onEnter={onEnterWorld}
                  onViewDetails={onViewDetails}
                  onDelete={onDeleteWorld}
                />
              ))}
            </div>
          </section>
        )}

        {worlds.length === 0 && (
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
