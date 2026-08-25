import { FROSTFOX_LEVEL_WORLD_IDS } from "@covel/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFrostFoxAccount } from "@/components/frostfox-account-summary.js";
import { BalatroTransition } from "@/components/visual-effects/balatro-transition.js";
import { Button } from "@/components/ui/button.js";
import { useSettingsDialog } from "@/hooks/use-settings-dialog.js";
import { worldVisualForId } from "@/lib/world-visuals.js";
import { fetchFrostFoxProgression } from "@/services/api.js";
import { SettingsDialog } from "@/settings/SettingsDialog.js";
import {
  Particles,
  ShinyText,
  DecryptedText,
  Magnet,
  StarBorder,
} from "@/components/reactbits/index.js";

const AUTO_LOGIN_ATTEMPT_KEY = "covel:frostfox:auto-login-attempted";
const DEFAULT_MARKET_URL = "https://market.dstopology.com";
const HOME_TRANSITION_MS = 1_280;
const HOME_PRIMARY_ACTION_CLASS =
  "group h-14 w-full rounded-xl border border-white/20 bg-white/95 px-7 text-sm font-semibold text-zinc-900 shadow-xl shadow-black/25 backdrop-blur-md transition-all duration-300 hover:bg-white hover:scale-[1.02] hover:shadow-2xl active:scale-[0.98] dark:bg-zinc-100 dark:text-zinc-900";
const HOME_SECONDARY_ACTION_CLASS =
  "group h-14 w-full rounded-xl border border-white/15 bg-black/40 px-7 text-sm font-medium text-zinc-200 shadow-lg backdrop-blur-md transition-all duration-300 hover:bg-black/60 hover:border-white/30 hover:text-white active:scale-[0.98]";

type LoginState = "checking" | "redirecting" | "ready" | "failed";

export function GameHome() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { status, loading, error } = useFrostFoxAccount();
  const settings = useSettingsDialog();
  const autoLoginStarted = useRef(false);
  const [loginState, setLoginState] = useState<LoginState>("checking");
  const [currentLevel, setCurrentLevel] = useState(1);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    if (loading) {
      setLoginState("checking");
      return;
    }
    if (error || !status) {
      setLoginState("failed");
      return;
    }
    if (!status.enabled) {
      setLoginState("ready");
      return;
    }
    if (status.authenticated) {
      sessionStorage.removeItem(AUTO_LOGIN_ATTEMPT_KEY);
      clearFrostFoxCallbackQuery();
      setLoginState("ready");
      return;
    }
    if (autoLoginStarted.current) return;

    const callbackResult = new URLSearchParams(window.location.search).get(
      "frostfox",
    );
    const attempted = sessionStorage.getItem(AUTO_LOGIN_ATTEMPT_KEY) === "1";
    if (callbackResult === "error" || attempted) {
      setLoginState("failed");
      return;
    }

    autoLoginStarted.current = true;
    sessionStorage.setItem(AUTO_LOGIN_ATTEMPT_KEY, "1");
    setLoginState("redirecting");
    window.location.replace("/auth/frostfox/start");
  }, [error, loading, status]);

  useEffect(() => {
    let cancelled = false;
    if (!status?.authenticated) {
      setCurrentLevel(1);
      return;
    }
    fetchFrostFoxProgression(true)
      .then((progression) => {
        if (!cancelled) setCurrentLevel(progression.unlockedLevel);
      })
      .catch(() => {
        if (!cancelled) setCurrentLevel(1);
      });
    return () => {
      cancelled = true;
    };
  }, [status?.account?.id, status?.authenticated]);

  const currentWorldId = FROSTFOX_LEVEL_WORLD_IDS[currentLevel - 1];
  const currentWorldVisual = worldVisualForId(currentWorldId);
  const homeCover = "/visuals/backgrounds/frostfox-game-cover-image2.png";
  const requiresLogin = Boolean(status?.enabled && !status.authenticated);
  const loginPending =
    loginState === "checking" || loginState === "redirecting";
  const marketUrl = status?.routerBaseUrl ?? DEFAULT_MARKET_URL;

  function retryLogin() {
    sessionStorage.removeItem(AUTO_LOGIN_ATTEMPT_KEY);
    autoLoginStarted.current = true;
    setLoginState("redirecting");
    window.location.assign("/auth/frostfox/start");
  }

  function handleMarketLogin() {
    sessionStorage.removeItem(AUTO_LOGIN_ATTEMPT_KEY);
  }

  function handleStartGame() {
    if (transitioning) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      void navigate({ to: "/session" });
      return;
    }
    setTransitioning(true);
    window.setTimeout(() => {
      void navigate({ to: "/session" });
    }, HOME_TRANSITION_MS);
  }

  return (
    <section
      aria-labelledby="game-home-title"
      className="relative isolate h-full min-h-[560px] w-full overflow-hidden bg-zinc-950 text-zinc-100 selection:bg-white/20 selection:text-white"
    >
      {/* 4K/2K High-Definition Cover Artwork with Responsive Rendering */}
      <img
        key={homeCover}
        src={homeCover}
        alt=""
        width={3840}
        height={2160}
        loading="eager"
        fetchPriority="high"
        decoding="async"
        draggable={false}
        className="absolute inset-0 h-full w-full animate-in object-cover object-center fade-in-0 duration-1000 scale-[1.02] transform-gpu transition-transform ease-out"
      />

      {/* Cinematic Vignette Overlay */}
      <div
        className="absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(circle at 50% 45%, rgba(9,9,11,0.25) 0%, rgba(9,9,11,0.65) 45%, rgba(9,9,11,0.92) 100%), linear-gradient(180deg, rgba(9,9,11,0.5) 0%, transparent 25%, transparent 60%, rgba(9,9,11,0.9) 100%)",
        }}
      />

      {/* React Bits Ambient Particles Animation */}
      <Particles
        particleCount={35}
        speed={0.4}
        particleColors={["#ffffff", "#e4e4e7", "#a1a1aa", "#d4d4d8"]}
        particleBaseSize={1.6}
        connectParticles={false}
        className="opacity-70 mix-blend-screen"
      />

      <div className="relative z-10 flex h-full items-center justify-center px-6 py-20 text-center sm:px-10">
        <div className="flex w-full max-w-3xl -translate-y-[2vh] flex-col items-center">
          {/* Logo Mark with Floating Animation */}
          <div className="relative animate-[float-gentle_4s_ease-in-out_infinite]">
            <img
              src="/icon.png"
              alt=""
              width={160}
              height={160}
              aria-hidden="true"
              className="h-24 w-24 drop-shadow-[0_8px_24px_rgba(0,0,0,.6)] sm:h-28 sm:w-28"
            />
          </div>

          {/* React Bits ShinyText Title */}
          <h1
            id="game-home-title"
            className="mt-5 font-display text-[clamp(2.8rem,7.5vw,5.4rem)] font-bold leading-none tracking-[0.06em] text-white [text-shadow:0_4px_24px_rgba(0,0,0,.6)]"
          >
            <ShinyText speed={4.5} shineColor="rgba(255, 255, 255, 0.9)">
              {t("home.gameTitle")}
            </ShinyText>
          </h1>

          {/* Subtitle / Narrative Body */}
          <p className="mt-5 max-w-xl text-sm leading-relaxed tracking-[0.06em] text-zinc-300/90 sm:text-base font-sans drop-shadow-[0_2px_8px_rgba(0,0,0,.5)]">
            {t("home.gameBody")}
          </p>

          {/* Level Progress Indicator with DecryptedText */}
          {status?.authenticated && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/40 px-3.5 py-1 text-xs text-zinc-300 backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <DecryptedText
                text={`Level ${currentLevel} : ${currentWorldVisual?.label ?? "FrostFox World"}`}
                speed={40}
                animateOn="view"
                className="font-mono text-xs font-medium text-zinc-200"
              />
            </div>
          )}

          {/* Action Buttons Section */}
          <div className="mt-8 flex w-full max-w-[23rem] flex-col items-center gap-3.5">
            {loginPending ? (
              <Button
                size="lg"
                disabled
                isLoading
                className="h-14 w-full rounded-xl bg-white/80 px-7 text-sm font-semibold text-zinc-900"
              >
                <FantasyGateIcon className="mr-2 h-5 w-5" />
                {t("home.autoLogin")}
              </Button>
            ) : requiresLogin || loginState === "failed" ? (
              <div
                role="alert"
                className="w-full rounded-2xl border border-white/20 bg-zinc-950/85 p-5 text-left shadow-[0_20px_50px_rgba(0,0,0,.5)] backdrop-blur-xl"
              >
                <div className="flex items-start gap-3">
                  <FantasyGateIcon className="mt-0.5 h-6 w-6 shrink-0 text-amber-300" />
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {t("home.mainLoginRequired")}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                      {t("home.mainLoginRequiredBody")}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-2.5">
                  <a
                    href={marketUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={handleMarketLogin}
                    className="group inline-flex h-11 items-center justify-center rounded-xl bg-white px-4 text-xs font-semibold text-zinc-900 transition-all hover:bg-zinc-200 active:scale-[0.98]"
                  >
                    <FantasyGateIcon className="mr-2 h-4 w-4 text-current" />
                    {t("home.openMainSite")}
                  </a>
                  <button
                    type="button"
                    onClick={retryLogin}
                    className="h-10 rounded-xl border border-white/20 text-xs font-medium text-zinc-300 transition-colors hover:border-white/40 hover:text-white active:scale-[0.98]"
                  >
                    {t("home.retryAutoLogin")}
                  </button>
                </div>
              </div>
            ) : (
              <Magnet padding={80} magnetStrength={3} className="w-full">
                <StarBorder
                  color="rgba(255, 255, 255, 0.6)"
                  speed="5s"
                  className="w-full rounded-xl"
                >
                  <Button
                    size="lg"
                    onClick={handleStartGame}
                    disabled={transitioning}
                    className={HOME_PRIMARY_ACTION_CLASS}
                  >
                    <FantasyGateIcon className="mr-2 h-5 w-5 text-current transition-transform group-hover:scale-110" />
                    {transitioning
                      ? t("home.enteringWorld")
                      : t("home.startPlaying")}
                  </Button>
                </StarBorder>
              </Magnet>
            )}

            {!loginPending && !requiresLogin && loginState !== "failed" && (
              <Magnet padding={60} magnetStrength={4} className="w-full">
                <Button
                  size="lg"
                  onClick={() => settings.openWithKey("llm.providers")}
                  disabled={transitioning}
                  className={HOME_SECONDARY_ACTION_CLASS}
                >
                  <FantasySettingsIcon className="mr-2 h-5 w-5 text-current transition-transform group-hover:rotate-45" />
                  {t("home.openSettings")}
                </Button>
              </Magnet>
            )}
          </div>
        </div>
      </div>

      {transitioning && (
        <div
          className="fixed inset-0 z-[100] bg-black"
          role="status"
          aria-live="polite"
        >
          <BalatroTransition />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,.3)_46%,rgba(0,0,0,.85)_100%)]"
          />
          <div className="absolute inset-x-0 bottom-[12vh] flex justify-center px-6">
            <span className="rounded-full border border-white/20 bg-black/70 px-6 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white backdrop-blur-md shadow-2xl">
              {t("home.enteringWorld")}
            </span>
          </div>
          <span className="sr-only">{t("home.enteringWorld")}</span>
        </div>
      )}

      <SettingsDialog
        open={settings.open}
        onOpenChange={settings.onOpenChange}
        initialKey={settings.initialKey}
        focusNode="llm.providers"
      />
    </section>
  );
}

function FantasyGateIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 21h18" />
      <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" />
      <path d="M9 21v-4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4" />
      <path d="M10 7h4" />
    </svg>
  );
}

function FantasySettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function clearFrostFoxCallbackQuery() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("frostfox")) return;
  url.searchParams.delete("frostfox");
  window.history.replaceState({}, "", url.toString());
}
