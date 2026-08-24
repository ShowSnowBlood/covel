import { Link } from "@tanstack/react-router";
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
      className="relative isolate h-full min-h-[560px] w-full overflow-hidden bg-[#071013] text-[#f4f0e5]"
    >
      <img
        src="/visuals/backgrounds/moonveil-home-2k.webp"
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

          <div className="mt-9 flex w-full max-w-[31rem] flex-col gap-3 sm:flex-row">
            {loading && !status ? (
              <Button
                size="lg"
                disabled
                className="h-14 flex-1 rounded-[10px] bg-[#e4ce8c] px-7 text-sm font-semibold text-[#191914]"
              >
                {t("account.checking")}
              </Button>
            ) : requiresLogin ? (
              <Button
                size="lg"
                asChild
                className="h-14 flex-1 rounded-[10px] bg-[#e4ce8c] px-7 text-sm font-semibold text-[#191914] hover:bg-[#f0dda2]"
              >
                <a href="/auth/frostfox/start">
                  <img
                    src="/visuals/ui/moonveil-enter.svg"
                    alt=""
                    width={24}
                    height={24}
                    aria-hidden="true"
                    className="mr-2 h-5 w-5"
                  />
                  {t("home.startPlaying")}
                </a>
              </Button>
            ) : (
              <Button
                size="lg"
                asChild
                className="h-14 flex-1 rounded-[10px] bg-[#e4ce8c] px-7 text-sm font-semibold text-[#191914] hover:bg-[#f0dda2]"
              >
                <Link to="/session">
                  <img
                    src="/visuals/ui/moonveil-enter.svg"
                    alt=""
                    width={24}
                    height={24}
                    aria-hidden="true"
                    className="mr-2 h-5 w-5"
                  />
                  {t("home.startPlaying")}
                </Link>
              </Button>
            )}

            <Button
              size="lg"
              variant="outline"
              onClick={() => settings.openWithKey("llm.providers")}
              className="h-14 flex-1 rounded-[10px] border-[#eee5ca]/80 bg-[#061316]/60 px-7 text-sm font-semibold text-[#f4f0e5] hover:bg-[#102428]/85 hover:text-white"
            >
              <img
                src="/visuals/ui/moonveil-settings.svg"
                alt=""
                width={24}
                height={24}
                aria-hidden="true"
                className="mr-2 h-5 w-5"
              />
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
