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

const AUTO_LOGIN_ATTEMPT_KEY = "covel:frostfox:auto-login-attempted";
const DEFAULT_MARKET_URL = "https://market.dstopology.com";
const HOME_TRANSITION_MS = 1_280;
const HOME_PRIMARY_ACTION_CLASS =
  "group h-14 w-full rounded-[10px] border border-[#e4ce8c] bg-[#e4ce8c] px-7 text-sm font-semibold text-[#191914] transition-colors hover:border-[#102428] hover:bg-[#102428] hover:text-[#f0dda2]";
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
  const homeCover =
    currentWorldVisual?.image ?? "/visuals/backgrounds/moonveil-home-2k.webp";
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
      className="relative isolate h-full min-h-[560px] w-full overflow-hidden bg-[#071013] text-[#f4f0e5]"
    >
      <img
        key={homeCover}
        src={homeCover}
        alt=""
        width={3840}
        height={2160}
        loading="eager"
        fetchPriority="high"
        draggable={false}
        className="absolute inset-0 h-full w-full animate-in object-cover object-center fade-in-0 duration-700"
      />
      <div
        className="absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(circle at 50% 43%, rgba(4,17,20,.22) 0%, rgba(4,17,20,.52) 34%, rgba(3,10,12,.16) 65%), linear-gradient(180deg, rgba(3,10,12,.45) 0%, transparent 25%, transparent 67%, rgba(3,10,12,.7) 100%)",
        }}
      />

      <div className="relative z-10 flex h-full items-center justify-center px-6 py-20 text-center sm:px-10">
        <div className="flex w-full max-w-3xl -translate-y-[2vh] flex-col items-center">
          <img
            src="/visuals/ui/moonveil-mark.svg"
            alt=""
            width={160}
            height={160}
            aria-hidden="true"
            className="h-24 w-24 drop-shadow-[0_4px_12px_rgba(0,0,0,.35)] sm:h-28 sm:w-28"
          />
          <h1
            id="game-home-title"
            className="mt-5 font-display text-[clamp(3rem,8vw,5.8rem)] font-bold leading-none tracking-[0.08em] text-[#f8f4e8] [text-shadow:0_3px_18px_rgba(0,0,0,.42)]"
          >
            {t("home.gameTitle")}
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-relaxed tracking-[0.08em] text-[#eef0e7]/85 sm:text-base">
            {t("home.gameBody")}
          </p>

          <div className="mt-9 flex w-full max-w-[23rem] flex-col items-center gap-3">
            {loginPending ? (
              <Button
                size="lg"
                disabled
                className="h-14 w-full rounded-[10px] bg-[#e4ce8c] px-7 text-sm font-semibold text-[#191914]"
              >
                <FantasyGateIcon className="mr-2 h-5 w-5" />
                {t("home.autoLogin")}
              </Button>
            ) : requiresLogin || loginState === "failed" ? (
              <div
                role="alert"
                className="w-full rounded-[12px] border border-[#ead99e]/45 bg-[#071316]/88 p-4 text-left shadow-[0_18px_48px_rgba(0,0,0,.32)] backdrop-blur-md"
              >
                <div className="flex items-start gap-3">
                  <FantasyGateIcon className="mt-0.5 h-6 w-6 shrink-0 text-[#e4ce8c]" />
                  <div>
                    <p className="text-sm font-semibold text-[#f4f0e5]">
                      {t("home.mainLoginRequired")}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-[#f4f0e5]/68">
                      {t("home.mainLoginRequiredBody")}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-2">
                  <a
                    href={marketUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={handleMarketLogin}
                    className="group inline-flex h-11 items-center justify-center rounded-[9px] bg-[#e4ce8c] px-4 text-xs font-semibold text-[#191914] transition-colors hover:bg-[#102428] hover:text-[#f0dda2]"
                  >
                    <FantasyGateIcon className="mr-2 h-4 w-4 text-current" />
                    {t("home.openMainSite")}
                  </a>
                  <button
                    type="button"
                    onClick={retryLogin}
                    className="h-10 rounded-[9px] border border-[#eee5ca]/35 text-xs font-medium text-[#f4f0e5]/78 transition-colors hover:border-[#e4ce8c] hover:text-[#e4ce8c]"
                  >
                    {t("home.retryAutoLogin")}
                  </button>
                </div>
              </div>
            ) : (
              <Button
                size="lg"
                onClick={handleStartGame}
                disabled={transitioning}
                className={HOME_PRIMARY_ACTION_CLASS}
              >
                <FantasyGateIcon className="mr-2 h-5 w-5 text-current" />
                {transitioning
                  ? t("home.enteringWorld")
                  : t("home.startPlaying")}
              </Button>
            )}

            {!loginPending && !requiresLogin && loginState !== "failed" && (
              <Button
                size="lg"
                onClick={() => settings.openWithKey("llm.providers")}
                disabled={transitioning}
                className={HOME_PRIMARY_ACTION_CLASS}
              >
                <FantasySettingsIcon className="mr-2 h-5 w-5 text-current" />
                {t("home.openSettings")}
              </Button>
            )}
          </div>
        </div>
      </div>

      {transitioning && (
        <div
          className="fixed inset-0 z-[100] bg-[#030708]"
          role="status"
          aria-live="polite"
        >
          <BalatroTransition />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(2,8,9,.16)_46%,rgba(2,8,9,.68)_100%)]"
          />
          <div className="absolute inset-x-0 bottom-[12vh] flex justify-center px-6">
            <span className="border-y border-[#ead99e]/45 bg-[#061113]/62 px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.34em] text-[#f4e4aa] backdrop-blur-sm">
              {t("home.enteringWorld")}
            </span>
          </div>
          <span className="sr-only">
            {t("home.enteringWorld")}
          </span>
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
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M7.5 26V11.5L16 5l8.5 6.5V26M4.5 26h23"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 26v-9.25c0-2.9 1.8-5.25 4-5.25s4 2.35 4 5.25V26"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="m15 15 4 3-4 3v-6Z" fill="currentColor" />
      <path
        d="m7.5 11.5-3-1.5 3-1.5M24.5 11.5l3-1.5-3-1.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FantasySettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="m16 8 2.2 5.8L24 16l-5.8 2.2L16 24l-2.2-5.8L8 16l5.8-2.2L16 8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="2.4" fill="currentColor" />
      <path
        d="M16 3v3M16 26v3M3 16h3M26 16h3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function clearFrostFoxCallbackQuery() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("frostfox") && !url.searchParams.has("code")) {
    return;
  }
  url.searchParams.delete("frostfox");
  url.searchParams.delete("code");
  window.history.replaceState(window.history.state, "", url);
}
