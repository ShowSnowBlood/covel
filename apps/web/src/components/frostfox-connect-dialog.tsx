import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Sparkles,
  Zap,
  Cloud,
  Palette,
  ArrowRight,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog.js";
import { Button } from "@/components/ui/button.js";
import { ShinyText } from "@/components/reactbits/index.js";

export interface FrostFoxConnectDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirmConnect?: () => void;
}

export function FrostFoxConnectDialog({
  open,
  onOpenChange,
  onConfirmConnect,
}: FrostFoxConnectDialogProps) {
  const { t } = useTranslation();
  const [connecting, setConnecting] = useState(false);

  const handleConnect = () => {
    setConnecting(true);
    if (onConfirmConnect) {
      onConfirmConnect();
    } else {
      window.location.assign("/auth/frostfox/start");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="frostfox-connect-dialog"
        className="max-w-[92vw] sm:max-w-lg p-0 overflow-hidden border border-border/80 bg-card/95 backdrop-blur-2xl shadow-2xl rounded-3xl"
      >
        {/* Header Hero Area */}
        <div className="relative isolate px-6 pt-7 pb-5 text-center overflow-hidden border-b border-border/60">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-b from-primary/15 via-primary/5 to-transparent pointer-events-none"
          />
          <div
            aria-hidden="true"
            className="absolute -top-16 left-1/2 -translate-x-1/2 w-48 h-48 rounded-full bg-primary/20 blur-3xl pointer-events-none"
          />

          <div className="relative z-10 flex flex-col items-center">
            <div className="relative mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 shadow-lg shadow-primary/15 backdrop-blur-md">
              <img
                src="/icon.png?v=frostfox-game"
                alt=""
                width={80}
                height={80}
                aria-hidden="true"
                className="h-9 w-9 drop-shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
              />
              <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground shadow-xs">
                <Sparkles className="h-3 w-3" />
              </span>
            </div>

            <DialogHeader className="space-y-1.5 text-center sm:text-center">
              <DialogTitle className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                <ShinyText speed={4} className="text-foreground">
                  {t("frostfox.connectTitle")}
                </ShinyText>
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
                {t("frostfox.connectSubtitle")}
              </DialogDescription>
            </DialogHeader>
          </div>
        </div>

        {/* Privileges & Benefits List */}
        <div className="px-6 py-4 space-y-2.5">
          <div className="group flex items-start gap-3 rounded-2xl border border-border/70 bg-card/60 p-3 shadow-2xs backdrop-blur-xs transition-all duration-200 hover:border-primary/40 hover:bg-card/85">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25">
              <Zap className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-foreground">
                {t("frostfox.benefitModelTitle")}
              </div>
              <div className="text-[11px] leading-relaxed text-muted-foreground mt-0.5">
                {t("frostfox.benefitModelDesc")}
              </div>
            </div>
          </div>

          <div className="group flex items-start gap-3 rounded-2xl border border-border/70 bg-card/60 p-3 shadow-2xs backdrop-blur-xs transition-all duration-200 hover:border-primary/40 hover:bg-card/85">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/25">
              <Cloud className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-foreground">
                {t("frostfox.benefitCloudTitle")}
              </div>
              <div className="text-[11px] leading-relaxed text-muted-foreground mt-0.5">
                {t("frostfox.benefitCloudDesc")}
              </div>
            </div>
          </div>

          <div className="group flex items-start gap-3 rounded-2xl border border-border/70 bg-card/60 p-3 shadow-2xs backdrop-blur-xs transition-all duration-200 hover:border-primary/40 hover:bg-card/85">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
              <Palette className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-foreground">
                {t("frostfox.benefitVisualTitle")}
              </div>
              <div className="text-[11px] leading-relaxed text-muted-foreground mt-0.5">
                {t("frostfox.benefitVisualDesc")}
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 pb-6 pt-2 flex flex-col sm:flex-row items-center justify-end gap-2.5 bg-card/40">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={connecting}
            className="w-full sm:w-auto text-xs text-muted-foreground hover:text-foreground rounded-xl"
          >
            {t("frostfox.maybeLater")}
          </Button>

          <Button
            type="button"
            size="default"
            onClick={handleConnect}
            disabled={connecting}
            className="w-full sm:w-auto h-10 px-5 text-xs font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 shadow-md shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            {connecting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                {t("frostfox.connecting")}
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4 mr-1.5" />
                {t("frostfox.connectNow")}
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
