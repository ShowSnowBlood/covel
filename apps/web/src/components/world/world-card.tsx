import { type CSSProperties } from "react";
import type { TFunction } from "i18next";
import {
  Eye,
  Trash2,
  ArrowRight,
  CheckCircle2,
  LockKeyhole,
  Link2,
} from "lucide-react";

import type { WorldRecord } from "@/services/api.js";
import { text } from "@/components/world/editor-helpers.js";
import { worldVisual } from "@/lib/world-visuals.js";
import { SpotlightCard, ShinyText } from "@/components/reactbits/index.js";

const CHAIN_HALF_LINKS = [0, 1, 2, 3] as const;

export interface WorldCardProps {
  world: WorldRecord;
  index: number;
  isEntering: boolean;
  dimmed: boolean;
  storageLabel: string;
  levelNumber?: number;
  locked?: boolean;
  completed?: boolean;
  lockLabel?: string;
  unlocking?: boolean;

  t: TFunction;

  onEnter: (worldId: string) => void;
  onLocked?: () => void;

  onViewDetails: (e: React.MouseEvent, worldId: string) => void;
  onDelete: (e: React.MouseEvent, worldId: string) => void;
}

/**
 * Single cover-led world plate in the world-select grid. Renders the 4K/2K cover
 * image, React Bits cursor-spotlight overlay, title/description, tag chips, and the
 * view-details / delete / enter action surface.
 */
export function WorldCard({
  world,
  index,
  isEntering,
  dimmed,
  storageLabel,
  levelNumber,
  locked = false,
  completed = false,
  lockLabel,
  unlocking = false,

  t,

  onEnter,
  onLocked,

  onViewDetails,
  onDelete,
}: WorldCardProps) {
  const visual = worldVisual(world);
  return (
    <article
      aria-busy={isEntering}
      aria-disabled={locked || unlocking}
      onClick={() => {
        if (unlocking) return;
        if (locked) onLocked?.();
        else onEnter(world.id);
      }}
      className={`group relative min-h-[280px] sm:min-h-[320px] md:min-h-[332px] overflow-hidden rounded-2xl border border-border/80 bg-card transition-all duration-300 hover:border-primary/50 hover:shadow-xl ${
        unlocking
          ? "cursor-wait"
          : locked
            ? onLocked
              ? "cursor-pointer"
              : "cursor-not-allowed"
            : "cursor-pointer"
      } ${isEntering ? "opacity-100 scale-[1.01]" : ""} ${
        dimmed ? "opacity-30 pointer-events-none" : ""
      }`}
      style={
        {
          "--world-accent": visual.accent,
          boxShadow: isEntering
            ? "0 24px 80px -50px var(--world-accent)"
            : undefined,
        } as CSSProperties
      }
    >
      {/* 4K/2K High-Definition World Background Artwork */}
      <img
        src={visual.image}
        alt=""
        aria-hidden="true"
        width={3840}
        height={2160}
        loading={index < 2 ? "eager" : "lazy"}
        fetchPriority={index < 2 ? "high" : "auto"}
        decoding="async"
        className={`absolute inset-0 h-full w-full object-cover transition-all duration-700 ease-out ${
          locked || unlocking
            ? "scale-[1.01] grayscale opacity-55"
            : "group-hover:scale-[1.04]"
        } ${unlocking ? "level-cover-unlocking" : ""}`}
        draggable={false}
      />

      {/* Cinematic Vignette Overlays */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,.15) 0%, rgba(0,0,0,.45) 46%, rgba(0,0,0,.85) 100%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-80"
        style={{
          background:
            "linear-gradient(90deg, rgba(0,0,0,.68) 0%, rgba(0,0,0,.3) 58%, rgba(0,0,0,.2) 100%)",
        }}
      />

      {/* Top Accent Stripe with Glow */}
      <div
        aria-hidden
        className="absolute left-0 top-0 h-1 w-24 transition-all duration-300 group-hover:w-48 shadow-[0_0_12px_var(--world-accent)]"
        style={{ background: "var(--world-accent)" }}
      />

      <div className="relative z-10 flex min-h-[280px] sm:min-h-[320px] md:min-h-[332px] flex-col justify-between p-4 sm:p-5 md:p-6 text-white">
        <div className="flex items-start justify-between gap-3">
          <span className="ui-meta text-[10px] text-white/70 font-mono tracking-wider tabular-nums">
            {levelNumber
              ? t("session.levelNumber", {
                  level: levelNumber,
                  defaultValue: "LEVEL {{level}}",
                })
              : `№ ${String(index + 1).padStart(2, "0")} · ${world.id}`}
          </span>
          {levelNumber ? (
            <span
              className={`ui-tag inline-flex items-center gap-1.5 rounded-full border border-white/20 px-2.5 py-0.5 text-[11px] backdrop-blur-md transition-colors ${
                completed
                  ? "bg-emerald-950/60 text-emerald-300 border-emerald-500/30"
                  : locked
                    ? "bg-black/40 text-white/70"
                    : "bg-white/15 text-white"
              }`}
            >
              {completed ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : locked ? (
                <LockKeyhole className="h-3.5 w-3.5" />
              ) : null}
              {completed
                ? t("session.levelCompleted", "Completed")
                : unlocking
                  ? t("session.levelUnlocking", "Unlocking")
                  : locked
                    ? t("session.levelLocked", "Locked")
                    : t("session.levelAvailable", "Available")}
            </span>
          ) : (
            <span
              className="ui-tag rounded-full border border-white/20 bg-black/30 px-2.5 py-0.5 text-[11px] text-white/80 backdrop-blur-md"
              title={t("session.worldStorage", "World storage")}
            >
              {storageLabel}
            </span>
          )}
        </div>

        <div className="space-y-3.5">
          <div className="max-w-[31rem] space-y-2">
            <h2
              className="ui-title text-2xl sm:text-3xl md:text-[2.35rem] font-bold leading-[1.08] sm:leading-[1.05] tracking-tight text-white transition-colors"
              style={isEntering ? { color: "var(--world-accent)" } : undefined}
            >
              {text(world.name)}
            </h2>
            <p className="text-[13px] sm:text-[14px] leading-relaxed text-white/80 line-clamp-2 sm:line-clamp-3 break-words [overflow-wrap:anywhere]">
              {text(world.description)}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(world.tags ?? []).slice(0, 5).map((tag) => (
              <span
                key={tag}
                className="ui-tag rounded-md border border-white/15 bg-black/30 px-2 py-0.5 text-[10px] text-white/75 backdrop-blur-md"
              >
                {tag}
              </span>
            ))}
            {(world.tags?.length ?? 0) > 5 && (
              <span className="ui-meta text-[10px] text-white/60 self-center">
                +{(world.tags?.length ?? 0) - 5}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-white/15 pt-3.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => onViewDetails(e, world.id)}
                aria-label={t("world.viewDetails", "View details")}
                className="inline-flex h-9 w-9 sm:h-8 sm:w-8 items-center justify-center rounded-xl border border-white/15 bg-black/25 text-white/80 backdrop-blur-md transition-all hover:bg-white/20 hover:text-white active:scale-95 cursor-pointer"
              >
                <Eye className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              </button>
              {world.metadata?.source !== "file" && (
                <button
                  type="button"
                  onClick={(e) => onDelete(e, world.id)}
                  aria-label={t("world.delete", "Delete world")}
                  className="inline-flex h-9 w-9 sm:h-8 sm:w-8 items-center justify-center rounded-xl border border-white/15 bg-black/25 text-white/80 backdrop-blur-md transition-all hover:bg-rose-500/20 hover:border-rose-500/40 hover:text-rose-300 active:scale-95 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                </button>
              )}
            </div>
            <span
              className="ui-meta inline-flex items-center gap-1.5 font-medium transition-all group-hover:gap-2.5"
              style={{
                color:
                  locked || unlocking
                    ? "rgba(255,255,255,.65)"
                    : "var(--world-accent)",
              }}
            >
              {unlocking
                ? t("session.levelUnlocking", "Unlocking")
                : locked
                  ? (lockLabel ?? t("session.levelLocked", "Locked"))
                  : completed
                    ? t("session.levelReplay", "Play again")
                    : t("session.enter", "Enter")}
              {locked || unlocking ? (
                <LockKeyhole className="w-3.5 h-3.5" />
              ) : (
                <ArrowRight className="w-3.5 h-3.5" />
              )}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

function LevelLockOverlay({ unlocking }: { unlocking: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-state={unlocking ? "unlocking" : "locked"}
      className="level-lock-overlay pointer-events-none absolute inset-0 z-20 overflow-hidden"
    >
      <ChainTrack variant="a" />
      <ChainTrack variant="b" />
      <div className="level-lock-seal">
        <div className="level-lock-seal-ring">
          <LockKeyhole className="h-5 w-5" />
        </div>
      </div>
      <div className="level-lock-flash" />
      <div className="level-lock-spark level-lock-spark-a" />
      <div className="level-lock-spark level-lock-spark-b" />
      <div className="level-lock-spark level-lock-spark-c" />
      <div className="level-lock-spark level-lock-spark-d" />
    </div>
  );
}

function ChainTrack({ variant }: { variant: "a" | "b" }) {
  return (
    <div className={`level-chain level-chain-${variant}`}>
      <div className="level-chain-half level-chain-half-start">
        {CHAIN_HALF_LINKS.map((key) => (
          <ChainLink key={`start-${key}`} />
        ))}
      </div>
      <div className="level-chain-joint" />
      <div className="level-chain-half level-chain-half-end">
        {CHAIN_HALF_LINKS.map((key) => (
          <ChainLink key={`end-${key}`} />
        ))}
      </div>
    </div>
  );
}

function ChainLink() {
  return (
    <svg viewBox="0 0 44 44" fill="none" className="level-chain-link">
      <rect
        x="6"
        y="12"
        width="32"
        height="20"
        rx="10"
        strokeWidth="3.2"
        stroke="currentColor"
      />
      <circle cx="22" cy="22" r="3.2" fill="currentColor" />
    </svg>
  );
}
