import { FROSTFOX_LEVEL_WORLD_IDS } from "@covel/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Sparkles,
  ArrowRight,
  Boxes,
  Image as ImageIcon,
  Code2,
  BookOpen,
  Loader2,
  LogIn,
  KeyRound,
} from "lucide-react";
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
  SpotlightCard,
  Magnet,
  StarBorder,
} from "@/components/reactbits/index.js";

const AUTO_LOGIN_ATTEMPT_KEY = "covel:frostfox:auto-login-attempted";
const DEFAULT_MARKET_URL = "https://market.dstopology.com";
const HOME_TRANSITION_MS = 1_280;

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
  const heroImage =
    currentWorldVisual?.image || "/visuals/backgrounds/home-hero.webp";

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
    <main
      aria-labelledby="game-home-title"
      className="relative isolate h-full w-full overflow-y-auto ui-scroll bg-background text-foreground flex flex-col justify-between"
    >
      {/* Subtle ambient particle backdrop */}
      <Particles
        particleCount={24}
        speed={0.3}
        particleColors={["#a1a1aa", "#71717a", "#d4d4d8"]}
        particleBaseSize={1.5}
        className="opacity-40 pointer-events-none"
      />

      <div className="relative z-10 w-full max-w-5xl mx-auto px-4 sm:px-6 md:px-8 py-8 md:py-12 flex-1 flex flex-col justify-center gap-8 md:gap-10">
        {/* Section Header: 从这里开始 */}
        <header className="space-y-1.5 text-left">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-rose-500/10 text-rose-500 border border-rose-500/20 text-xs">
              <Sparkles className="w-3 h-3" />
            </span>
            <h1
              id="game-home-title"
              className="text-xl sm:text-2xl font-bold tracking-tight text-foreground"
            >
              <ShinyText speed={5} shineColor="rgba(var(--color-primary), 0.8)">
                {t("home.startHere", "Get Started")}
              </ShinyText>
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-2xl">
            {t(
              "home.startHereSubtitle",
              "Choose a way to start using FrostFox right away; no need to configure all settings first.",
            )}
          </p>
        </header>

        {/* Featured Hero Card: 选择世界，开始你的故事 */}
        <section
          onClick={handleStartGame}
          className="group relative overflow-hidden rounded-3xl border border-border/80 bg-card/85 shadow-xl backdrop-blur-xl transition-all duration-300 hover:border-primary/40 hover:shadow-2xl cursor-pointer"
        >
          <div className="grid grid-cols-1 md:grid-cols-12 min-h-[300px] md:min-h-[320px]">
            {/* Left Cover Image (4K/2K Artwork) */}
            <div className="relative md:col-span-6 h-56 md:h-full overflow-hidden bg-muted">
              <img
                src={heroImage}
                alt=""
                width={1920}
                height={1080}
                loading="eager"
                fetchPriority="high"
                decoding="async"
                className="h-full w-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-105"
                draggable={false}
              />
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-t md:bg-gradient-to-r from-transparent via-transparent to-card/90"
              />
            </div>

            {/* Right Content Panel */}
            <div className="md:col-span-6 p-6 sm:p-8 flex flex-col justify-between gap-4">
              <div className="space-y-3">
                {/* Category Tag */}
                <div className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-0.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>{t("home.interactiveStory", "Interactive Story")}</span>
                </div>

                {/* Title */}
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground leading-snug">
                  {t("home.chooseWorldTitle", "Choose a World, Start Your Story")}
                </h2>

                {/* Description */}
                <p className="text-xs sm:text-sm leading-relaxed text-muted-foreground">
                  {t(
                    "home.chooseWorldDesc",
                    "Advance through chapters across Mistport, Academy, and unknown worlds; every choice shapes the journey.",
                  )}
                </p>
              </div>

              {/* Action Button Link */}
              <div className="pt-2">
                {loginPending ? (
                  <Button
                    size="sm"
                    disabled
                    isLoading
                    radius="full"
                    className="h-9 px-5"
                  >
                    {t("home.autoLogin", "Signing in automatically…")}
                  </Button>
                ) : requiresLogin || loginState === "failed" ? (
                  <Button
                    size="sm"
                    radius="full"
                    className="h-9 px-5 gap-1.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.location.assign("/auth/frostfox/start");
                    }}
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>{t("account.loginAction", "Sign in")}</span>
                  </Button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-rose-600 dark:text-rose-400 group-hover:gap-2.5 transition-all">
                    <span>{t("home.enterStoryGame", "Enter Story Game")}</span>
                    <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Three Feature Portal Cards */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-5">
          {/* Card 1: 进行编程构筑 */}
          <article
            onClick={() => settings.openWithKey("plugin")}
            className="group rounded-2xl border border-border/80 bg-card/75 p-5 md:p-6 shadow-sm backdrop-blur-md transition-all duration-200 hover:border-primary/40 hover:bg-card/95 hover:shadow-md cursor-pointer flex flex-col justify-between min-h-[160px]"
          >
            <div className="space-y-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20">
                <Boxes className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold text-foreground">
                {t("home.featureCodingTitle", "Agent Orchestration")}
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                {t(
                  "home.featureCodingDesc",
                  "Compose, execute, and continuously advance complex tasks in the Agent engine.",
                )}
              </p>
            </div>
            <div className="mt-4 pt-2">
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400 group-hover:gap-2 transition-all">
                <span>{t("home.enterOrchestration", "Open Engine")}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </div>
          </article>

          {/* Card 2: 进行图片视频创作 */}
          <article
            onClick={() => settings.openWithKey("llm.providers")}
            className="group rounded-2xl border border-border/80 bg-card/75 p-5 md:p-6 shadow-sm backdrop-blur-md transition-all duration-200 hover:border-primary/40 hover:bg-card/95 hover:shadow-md cursor-pointer flex flex-col justify-between min-h-[160px]"
          >
            <div className="space-y-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20">
                <ImageIcon className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold text-foreground">
                {t("home.featureMediaTitle", "Media & Visual Creation")}
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                {t(
                  "home.featureMediaDesc",
                  "Explore available channels and models for image and video generation.",
                )}
              </p>
            </div>
            <div className="mt-4 pt-2">
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400 group-hover:gap-2 transition-all">
                <span>{t("home.viewChannels", "View Channels")}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </div>
          </article>

          {/* Card 3: 直接使用 API */}
          <article
            onClick={() => settings.openWithKey("llm.keys")}
            className="group rounded-2xl border border-border/80 bg-card/75 p-5 md:p-6 shadow-sm backdrop-blur-md transition-all duration-200 hover:border-primary/40 hover:bg-card/95 hover:shadow-md cursor-pointer flex flex-col justify-between min-h-[160px]"
          >
            <div className="space-y-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20">
                <Code2 className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold text-foreground">
                {t("home.featureApiTitle", "Direct API Integration")}
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                {t(
                  "home.featureApiDesc",
                  "Generate a Gateway API Key to connect any OpenAI- or Anthropic-compatible client.",
                )}
              </p>
            </div>
            <div className="mt-4 pt-2">
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400 group-hover:gap-2 transition-all">
                <span>{t("home.manageApiKey", "Manage API Keys")}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </div>
          </article>
        </section>

        {/* Footer info tip */}
        <footer className="text-center pt-2">
          <p className="text-[11px] text-muted-foreground/75">
            {t(
              "home.footerNotice",
              "You can access overview, usage, billing, and logs from the menu at any time.",
            )}
          </p>
        </footer>
      </div>

      {/* Entering World Transition */}
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
              {t("home.enteringWorld", "Entering the world…")}
            </span>
          </div>
          <span className="sr-only">
            {t("home.enteringWorld", "Entering the world…")}
          </span>
        </div>
      )}

      {/* Settings Dialog */}
      <SettingsDialog
        open={settings.open}
        onOpenChange={settings.onOpenChange}
        initialKey={settings.initialKey}
        focusNode={settings.initialKey}
      />
    </main>
  );
}

function clearFrostFoxCallbackQuery() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("frostfox")) return;
  url.searchParams.delete("frostfox");
  window.history.replaceState({}, "", url.toString());
}
