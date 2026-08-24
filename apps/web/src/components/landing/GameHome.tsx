import { Link } from "@tanstack/react-router";
import { LogIn, Settings2, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFrostFoxAccount } from "@/components/frostfox-account-summary.js";
import { Button } from "@/components/ui/button.js";
import { useSettingsDialog } from "@/hooks/use-settings-dialog.js";
import { SettingsDialog } from "@/settings/SettingsDialog.js";

export function GameHome() {
  const { t } = useTranslation();
  const { status, loading } = useFrostFoxAccount();
  const settings = useSettingsDialog();
  const requiresLogin = Boolean(status?.enabled && !status.authenticated);

  return (
    <section
      aria-labelledby="game-home-title"
      className="relative isolate h-full min-h-[560px] w-full overflow-hidden bg-[#07090a] text-[#f4f0e5]"
    >
      <img
        src="/visuals/backgrounds/game-home-2k.webp"
        alt=""
        width={2048}
        height={1152}
        loading="eager"
        fetchPriority="high"
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
      <div
        className="absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "linear-gradient(90deg, rgba(5,8,10,.94) 0%, rgba(5,8,10,.74) 25%, rgba(5,8,10,.18) 58%, rgba(5,8,10,.08) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "linear-gradient(0deg, rgba(4,6,7,.88) 0%, transparent 42%), linear-gradient(180deg, rgba(4,6,7,.42) 0%, transparent 25%)",
        }}
      />

      <div className="relative z-10 flex h-full max-w-[1600px] items-end px-6 pb-[clamp(3.5rem,10vh,8rem)] sm:px-10 md:px-16 lg:px-24">
        <div className="max-w-2xl">
          <div className="mb-5 flex items-center gap-2 text-sm text-[#d8b66c]">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            <span>{t("home.gameLabel")}</span>
          </div>
          <h1
            id="game-home-title"
            className="font-display text-[clamp(3.5rem,8vw,6rem)] font-bold leading-[0.94] tracking-[-0.035em] text-[#f7f2e6] text-balance"
          >
            {t("home.gameTitle")}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-[#dedbd1]/80 sm:text-lg">
            {t("home.gameBody")}
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            {loading && !status ? (
              <Button
                size="lg"
                disabled
                className="h-12 min-w-44 rounded-[10px] bg-[#d5a13e] px-7 text-sm font-semibold text-[#15130f]"
              >
                {t("account.checking")}
              </Button>
            ) : requiresLogin ? (
              <Button
                size="lg"
                asChild
                className="h-12 min-w-44 rounded-[10px] bg-[#d5a13e] px-7 text-sm font-semibold text-[#15130f] hover:bg-[#e3b251]"
              >
                <a href="/auth/frostfox/start">
                  <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t("home.startPlaying")}
                </a>
              </Button>
            ) : (
              <Button
                size="lg"
                asChild
                className="h-12 min-w-44 rounded-[10px] bg-[#d5a13e] px-7 text-sm font-semibold text-[#15130f] hover:bg-[#e3b251]"
              >
                <Link to="/session">{t("home.startPlaying")}</Link>
              </Button>
            )}

            <Button
              size="lg"
              variant="outline"
              onClick={() => settings.openWithKey("llm.providers")}
              className="h-12 min-w-32 rounded-[10px] border-[#e5dfcf]/70 bg-[#080b0d]/55 px-7 text-sm font-semibold text-[#f4f0e5] hover:bg-[#161a1c] hover:text-white"
            >
              <Settings2 className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("home.openSettings")}
            </Button>
          </div>
        </div>
      </div>

      <SettingsDialog
        open={settings.open}
        onOpenChange={settings.onOpenChange}
        initialKey={settings.initialKey}
        focusNode="llm.providers"
      />
    </section>
  );
}
