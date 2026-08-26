import { useTranslation } from "react-i18next";
import { Flame, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { ShinyText } from "@/components/reactbits/index.js";
import { resolveI18n } from "@/lib/catalog/helpers.js";
import { worldVisual } from "@/lib/world-visuals.js";
import type { WorldRecord } from "@/services/api.js";

interface SessionCanvasHeroProps {
  world: WorldRecord | null;
  onBegin: () => void;
  beginLabel: string;
  hintLabel: string;
}

export function SessionCanvasHero({
  world,
  onBegin,
  beginLabel,
  hintLabel,
}: SessionCanvasHeroProps) {
  const { i18n } = useTranslation();
  const locale = i18n.language;

  const worldName = world ? resolveI18n(world.name, locale) : "";
  const start = world?.dimensions?.startingConditions;
  const hook = start?.openingHook
    ? resolveI18n(start.openingHook, locale)
    : worldName;
  const chips: string[] = (() => {
    if (start?.openingChips && start.openingChips.length > 0) {
      return start.openingChips
        .map((chip) => resolveI18n(chip, locale))
        .filter((s) => s.length > 0);
    }
    if (world?.tags && world.tags.length > 0) {
      return world.tags.slice(0, 3).map((tag) => String(tag));
    }
    return [];
  })();
  const summary = world ? resolveI18n(world.description, locale) : "";
  const visual = worldVisual(world);

  return (
    <div
      className="ui-session-canvas relative mx-auto my-2 max-w-4xl overflow-hidden rounded-3xl border border-border/80 bg-card shadow-2xl transition-all duration-300"
      style={{ "--world-accent": visual.accent } as React.CSSProperties}
    >
      <img
        src={visual.image}
        alt=""
        aria-hidden="true"
        width={1536}
        height={1024}
        loading="eager"
        fetchPriority="high"
        className="absolute inset-0 h-full w-full object-cover brightness-[0.95]"
        draggable={false}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, rgba(0,0,0,.85) 0%, rgba(0,0,0,.65) 55%, rgba(0,0,0,.35) 100%)",
        }}
      />
      <div
        aria-hidden
        className="absolute left-0 top-0 h-1.5 w-36 shadow-[0_0_16px_var(--world-accent)] rounded-r-full"
        style={{ background: "var(--world-accent)" }}
      />

      <div className="relative z-10 flex min-h-[280px] sm:min-h-[360px] flex-col justify-between p-5 sm:p-7 text-white md:min-h-[420px] md:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="ui-eyebrow flex items-center gap-1 text-[11px] font-mono tracking-wider text-white/80 uppercase">
            <Sparkles className="w-3 h-3 text-amber-400" />
            § SESSION CANVAS
          </span>
          {chips.map((chip, i) => (
            <span
              key={`${chip}-${i}`}
              className="rounded-lg border border-white/20 bg-black/40 px-2.5 py-0.5 text-xs font-medium text-white/90 backdrop-blur-md shadow-xs"
            >
              {chip}
            </span>
          ))}
        </div>

        <div className="max-w-2xl space-y-4">
          <h2
            className="ui-title text-2xl sm:text-3xl md:text-4xl font-extrabold leading-tight tracking-tight text-white drop-shadow-md"
            style={{ textWrap: "balance" } as React.CSSProperties}
          >
            {hook ? (
              <ShinyText disabled={false} speed={4} className="text-white">
                {hook}
              </ShinyText>
            ) : (
              hintLabel
            )}
          </h2>

          {(summary || hintLabel) && (
            <p className="max-w-xl text-xs sm:text-sm md:text-base leading-relaxed text-white/85 drop-shadow-xs line-clamp-4">
              {summary || hintLabel}
            </p>
          )}

          <div>
            <Button
              size="lg"
              className="mt-2 sm:mt-4 px-6 sm:px-8 py-3 sm:py-4 text-xs sm:text-sm font-bold uppercase tracking-wider rounded-2xl shadow-lg hover:shadow-2xl hover:scale-105 active:scale-95 transition-all duration-200"
              style={{ background: "var(--world-accent)", color: "black" }}
              onClick={onBegin}
            >
              <Flame className="w-4 h-4 mr-2 text-black" />
              {beginLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
