import React, { useEffect, useState, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { ShinyText, DecryptedText, Particles } from "@/components/reactbits/index.js";
import { cn } from "@/lib/utils.js";

export interface SceneLoadingTransitionProps {
  image?: string;
  title?: string;
  subtitle?: string;
  durationMs?: number;
  onComplete?: () => void;
  steps?: string[];
  className?: string;
}

/**
 * SceneLoadingTransition — Cinematic progress-bar scene loading overlay.
 * Uses high-resolution scenic backgrounds, smooth easing progress bar,
 * ambient particles, and step decoding animation.
 */
export function SceneLoadingTransition({
  image = "/visuals/backgrounds/home-hero.webp",
  title,
  subtitle,
  durationMs = 1500,
  onComplete,
  steps,
  className = "",
}: SceneLoadingTransitionProps) {
  const { t } = useTranslation();

  const resolvedSteps = useMemo(() => {
    if (steps && steps.length > 0) return steps;
    return [
      t("transition.syncRules", "Synchronizing world rules & lore…"),
      t("transition.loadPlugins", "Loading narrative pipeline & plugins…"),
      t("transition.connectModels", "Connecting neural model endpoints…"),
      t("transition.ready", "Ready, entering world…"),
    ];
  }, [steps, t]);

  const [progress, setProgress] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const completedRef = useRef(false);

  useEffect(() => {
    let animationFrameId: number;

    const updateProgress = (timestamp: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = timestamp;
      }

      const elapsed = timestamp - startTimeRef.current;
      const linearProgress = Math.min(elapsed / durationMs, 1);
      // Cubic ease-out curve for natural game loading deceleration
      const easedProgress = 1 - Math.pow(1 - linearProgress, 2.5);
      const percentage = Math.min(Math.round(easedProgress * 100), 100);

      setProgress(percentage);

      // Determine step based on progress
      const stepIdx = Math.min(
        Math.floor(linearProgress * resolvedSteps.length),
        resolvedSteps.length - 1,
      );
      setCurrentStepIndex(stepIdx);

      if (linearProgress < 1) {
        animationFrameId = requestAnimationFrame(updateProgress);
      } else if (!completedRef.current) {
        completedRef.current = true;
        setProgress(100);
        setTimeout(() => {
          onComplete?.();
        }, 150);
      }
    };

    animationFrameId = requestAnimationFrame(updateProgress);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [durationMs, resolvedSteps.length, onComplete]);

  const currentStepText = resolvedSteps[currentStepIndex] ?? resolvedSteps[0];

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed inset-0 z-[100] flex flex-col justify-between p-6 sm:p-10 md:p-14 bg-zinc-950 text-white overflow-hidden select-none animate-in fade-in-0 duration-300",
        className,
      )}
    >
      {/* 4K/2K High-Definition Background Artwork with Smooth Slow Zoom */}
      <img
        src={image}
        alt=""
        aria-hidden="true"
        width={3840}
        height={2160}
        loading="eager"
        fetchPriority="high"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover object-center scale-[1.06] transition-transform duration-[2000ms] ease-out opacity-65"
        draggable={false}
      />

      {/* Cinematic Dark Vignette */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 45%, rgba(9,9,11,0.4) 0%, rgba(9,9,11,0.78) 55%, rgba(9,9,11,0.96) 100%), linear-gradient(180deg, rgba(9,9,11,0.6) 0%, transparent 35%, transparent 60%, rgba(9,9,11,0.95) 100%)",
        }}
      />

      {/* Ambient particles */}
      <Particles
        particleCount={30}
        speed={0.4}
        particleColors={["#ffffff", "#fed7aa", "#fca5a5", "#e4e4e7"]}
        particleBaseSize={1.8}
        className="opacity-60 mix-blend-screen pointer-events-none"
      />

      {/* Top Brand / World Indicator */}
      <div className="relative z-10 flex items-center justify-between w-full max-w-5xl mx-auto">
        <div className="flex items-center gap-2 rounded-full border border-white/15 bg-black/40 px-3.5 py-1 text-xs backdrop-blur-md">
          <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" />
          <span className="font-mono text-zinc-200">FrostFox Game Engine</span>
        </div>
        <span className="text-xs font-mono text-zinc-400 tabular-nums">
          {progress}%
        </span>
      </div>

      {/* Center Title / Narrative text */}
      <div className="relative z-10 flex flex-col items-center text-center space-y-3 my-auto max-w-2xl mx-auto px-4">
        {title && (
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.8)]">
            <ShinyText speed={4} shineColor="rgba(255, 255, 255, 0.95)">
              {title}
            </ShinyText>
          </h2>
        )}
        {subtitle && (
          <p className="text-xs sm:text-sm text-zinc-300/90 leading-relaxed font-light drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
            {subtitle}
          </p>
        )}
      </div>

      {/* Bottom Progress Bar Card HUD */}
      <div className="relative z-10 w-full max-w-lg mx-auto">
        <div className="rounded-2xl border border-white/15 bg-black/60 backdrop-blur-2xl p-5 shadow-[0_20px_50px_rgba(0,0,0,0.8)] space-y-3.5">
          <div className="flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400 shrink-0" />
              <DecryptedText
                text={currentStepText}
                speed={30}
                animateOn="view"
                className="font-mono text-xs text-zinc-200 truncate"
              />
            </div>
            <span className="font-mono font-bold text-white tabular-nums shrink-0">
              {progress}%
            </span>
          </div>

          {/* Glowing Animated Progress Bar */}
          <div className="relative h-2 w-full rounded-full bg-white/10 overflow-hidden border border-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-400 transition-all duration-100 ease-out shadow-[0_0_16px_rgba(244,63,94,0.8)]"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
