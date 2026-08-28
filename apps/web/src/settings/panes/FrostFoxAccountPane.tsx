import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  CircleAlert,
  CircleUserRound,
  Copy,
  Cpu,
  Link2,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Unplug,
  WalletCards,
} from "lucide-react";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import {
  clearManagedFrostFoxSlots,
  disconnectFrostFox,
  setManagedFrostFoxCatalog,
  signOutFrostFox,
} from "@/services/api.js";
import { useFrostFoxAccount } from "@/components/frostfox-account-context.js";
export function FrostFoxAccountPane() {
  const { t, i18n } = useTranslation();
  const { status, catalog, loading, error, refresh } = useFrostFoxAccount();
  const [action, setAction] = useState<"signout" | "disconnect" | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [copied, setCopied] = useState(false);

  const signOut = async () => {
    setAction("signout");
    try {
      await signOutFrostFox();
      setManagedFrostFoxCatalog(null);
      clearManagedFrostFoxSlots();
      await refresh();
    } finally {
      setAction(null);
    }
  };

  const disconnect = async () => {
    setAction("disconnect");
    try {
      await disconnectFrostFox();
      setManagedFrostFoxCatalog(null);
      clearManagedFrostFoxSlots();
      await refresh();
      setConfirmDisconnect(false);
    } finally {
      setAction(null);
    }
  };

  if (loading && !status) {
    return (
      <div className="flex min-h-40 items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span className="sr-only">{t("settings.frostfox.loading")}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3 border border-destructive/40 bg-destructive/10 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <CircleAlert className="h-4 w-4" aria-hidden />
          {t("settings.frostfox.loadFailed")}
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          {t("settings.frostfox.retry")}
        </Button>
      </div>
    );
  }

  if (!status?.enabled) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <CircleUserRound
            className="h-4 w-4 text-muted-foreground"
            aria-hidden
          />
          <h3 className="text-sm font-semibold">
            {t("settings.frostfox.hostedOnlyTitle")}
          </h3>
        </div>
        <p className="max-w-[68ch] text-xs leading-relaxed text-muted-foreground">
          {t("settings.frostfox.hostedOnlyDescription")}
        </p>
      </div>
    );
  }

  if (!status.authenticated || !status.account) {
    return (
      <div className="space-y-5">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">
            {t("settings.frostfox.connectTitle")}
          </h3>
          <p className="max-w-[68ch] text-xs leading-relaxed text-muted-foreground">
            {t("settings.frostfox.connectDescription")}
          </p>
        </div>
        <div className="border border-border bg-muted/15 p-4">
          <div className="flex items-start gap-3">
            <Link2 className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-medium">
                {t("settings.frostfox.routerAccount")}
              </p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {t("settings.frostfox.credentialBoundary")}
              </p>
            </div>
          </div>
        </div>
        <Button onClick={() => window.location.assign("/auth/frostfox/start")}>
          <Link2 className="h-3.5 w-3.5" aria-hidden />
          {t("settings.frostfox.connectAction")}
        </Button>
      </div>
    );
  }

  const account = status.account;
  const balance = new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency: "USD",
  }).format(account.balance);
  const recoveryRequired = account.credentialState === "recovery_required";
  const initialChar = account.name.trim().charAt(0).toUpperCase() || "U";
  const totalModelCount =
    catalog?.channels.reduce(
      (sum, channel) => sum + channel.models.length,
      0,
    ) ?? 0;
  const modelsError = Boolean(
    !loading && status.authenticated && status.account && !catalog,
  );

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(account.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard failure
    }
  };

  return (
    <div className="space-y-5">
      {/* Account Profile Card */}
      <div className="rounded-2xl border border-border/80 bg-card/60 dark:bg-zinc-900/40 p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-bold text-sm bg-gradient-to-br from-primary/20 via-primary/10 to-primary/5 text-primary border border-primary/25 dark:from-white/20 dark:via-white/10 dark:to-white/5 dark:text-white dark:border-white/20 select-none shadow-sm">
              <span>{initialChar}</span>
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card dark:ring-zinc-950 ${
                  recoveryRequired
                    ? "bg-amber-500 animate-pulse"
                    : "bg-emerald-500"
                }`}
                aria-hidden="true"
              />
            </div>
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold tracking-tight text-foreground truncate">
                  {account.name}
                </h3>
                <Badge
                  variant={recoveryRequired ? "destructive" : "outline"}
                  className={`gap-1 text-[10px] ${
                    !recoveryRequired
                      ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                      : ""
                  }`}
                >
                  {recoveryRequired ? (
                    <ShieldAlert className="h-3 w-3" />
                  ) : (
                    <ShieldCheck className="h-3 w-3" />
                  )}
                  {recoveryRequired
                    ? t("settings.frostfox.reconnectRequired")
                    : t("settings.frostfox.connected")}
                </Badge>
                {(account.isAdmin || status.operatorAuthorized) && (
                  <Badge
                    variant="outline"
                    className="gap-1 border-primary/30 bg-primary/10 text-[10px] text-primary"
                  >
                    <ShieldCheck className="h-3 w-3" />
                    {t("settings.frostfox.modelAdmin")}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                <span className="truncate max-w-[200px]" title={account.id}>
                  {account.id}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopyId()}
                  aria-label={t("account.copyId", "Copy Account ID")}
                  className="hover:text-foreground transition-colors p-0.5 rounded cursor-pointer"
                >
                  {copied ? (
                    <Check className="h-3 w-3 text-emerald-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label={t("settings.frostfox.refresh")}
            className="h-8 gap-1.5 text-xs font-medium"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              aria-hidden
            />
            <span>{t("settings.frostfox.refresh")}</span>
          </Button>
        </div>

        {/* Balance & Quota Stats Grid */}
        <dl className="grid grid-cols-2 rounded-xl border border-border/70 bg-muted/30 overflow-hidden divide-x divide-border/70">
          <div className="p-3.5 space-y-1">
            <dt className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
              <WalletCards className="h-3.5 w-3.5 text-primary opacity-80" />
              {t("settings.frostfox.balance")}
            </dt>
            <dd className="text-base font-bold font-mono tracking-tight tabular-nums text-foreground">
              {balance}
            </dd>
          </div>
          <div className="p-3.5 space-y-1">
            <dt className="text-[11px] font-medium text-muted-foreground">
              {t("settings.frostfox.lastVerified")}
            </dt>
            <dd className="text-xs font-medium text-foreground pt-0.5">
              {new Intl.DateTimeFormat(i18n.language, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(account.lastVerifiedAt))}
            </dd>
          </div>
        </dl>
      </div>

      {recoveryRequired && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3.5 text-xs leading-relaxed text-destructive flex items-start gap-2.5">
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
          <div>{t("settings.frostfox.recoveryDescription")}</div>
        </div>
      )}

      {!recoveryRequired && (catalog || modelsError) && (
        <section
          className="space-y-3 border-t border-border pt-4"
          aria-labelledby="frostfox-managed-models-title"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h4
                id="frostfox-managed-models-title"
                className="flex items-center gap-2 text-sm font-semibold"
              >
                <Cpu className="h-4 w-4 text-primary" aria-hidden />
                {t("settings.frostfox.managedModelsTitle")}
              </h4>
              <p className="max-w-[68ch] text-[11px] leading-relaxed text-muted-foreground">
                {t("settings.frostfox.managedModelsDescription")}
              </p>
            </div>
            {catalog && (
              <Badge variant="outline" className="shrink-0 tabular-nums">
                {t("settings.frostfox.modelCount", {
                  count: totalModelCount,
                })}
              </Badge>
            )}
          </div>

          {modelsError ? (
            <div className="border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              {t("settings.frostfox.modelsLoadFailed")}
            </div>
          ) : (
            <div className="divide-y divide-border/70 rounded-xl border border-border/80 bg-card/40 overflow-hidden">
              {catalog?.channels.map((channel) => (
                <div key={channel.channelKey} className="space-y-2.5 p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-foreground">
                        {channel.displayName}
                      </p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                        {channel.channelKey}
                      </p>
                    </div>
                    <Badge
                      variant="secondary"
                      className="shrink-0 tabular-nums font-mono text-[11px]"
                    >
                      {channel.models.length}
                    </Badge>
                  </div>

                  {channel.error ? (
                    <p className="text-[11px] text-destructive">
                      {t("settings.frostfox.channelError", {
                        code: channel.error,
                      })}
                    </p>
                  ) : channel.models.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      {t("settings.frostfox.noModels")}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/50 rounded-lg border border-border/60 bg-muted/20 px-3">
                      {channel.models.map((model) => (
                        <li
                          key={model.id}
                          className="flex items-center justify-between gap-3 py-2.5 first:pt-2.5 last:pb-2.5"
                        >
                          <div className="min-w-0">
                            <p
                              className="truncate text-xs font-medium text-foreground"
                              title={model.name}
                            >
                              {model.name}
                            </p>
                            {model.name !== model.id && (
                              <p
                                className="truncate font-mono text-[10px] text-muted-foreground"
                                title={model.id}
                              >
                                {model.id}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-1">
                            {model.capability.output.map((output) => (
                              <Badge
                                key={output}
                                variant={
                                  output === "image" ? "default" : "outline"
                                }
                                className="text-[9.5px] px-1.5 py-0 h-4.5"
                              >
                                {t(`settings.frostfox.modality.${output}`, {
                                  defaultValue: output,
                                })}
                              </Badge>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="border-t border-border pt-4">
        {confirmDisconnect ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3.5 space-y-3">
            <p className="text-xs leading-relaxed text-destructive/90">
              {t("settings.frostfox.disconnectConfirm")}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDisconnect(false)}
                disabled={action !== null}
                className="h-8 text-xs"
              >
                {t("settings.frostfox.cancel")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void disconnect()}
                disabled={action !== null}
                className="h-8 gap-1.5 text-xs"
              >
                {action === "disconnect" && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                )}
                {t("settings.frostfox.disconnectAction")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void signOut()}
              disabled={action !== null}
              className="h-8 gap-1.5 text-xs"
            >
              {action === "signout" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <LogOut className="h-3.5 w-3.5" aria-hidden />
              )}
              {t("settings.frostfox.signOutAction")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setConfirmDisconnect(true)}
              disabled={action !== null}
            >
              <Unplug className="h-3.5 w-3.5" aria-hidden />
              {t("settings.frostfox.disconnectAction")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
