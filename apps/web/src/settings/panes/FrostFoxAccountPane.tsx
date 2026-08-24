import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CircleAlert,
  CircleUserRound,
  Link2,
  Loader2,
  LogOut,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import {
  disconnectFrostFox,
  fetchFrostFoxAccount,
  fetchFrostFoxModels,
  setManagedFrostFoxCatalog,
  signOutFrostFox,
  type FrostFoxAccountStatus,
} from "@/services/api.js";

export function FrostFoxAccountPane() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<FrostFoxAccountStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"signout" | "disconnect" | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [error, setError] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(false);
    try {
      const next = await fetchFrostFoxAccount(true);
      setStatus(next);
      if (next.authenticated) {
        setManagedFrostFoxCatalog(await fetchFrostFoxModels(true));
      } else {
        setManagedFrostFoxCatalog(null);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const signOut = async () => {
    setAction("signout");
    try {
      await signOutFrostFox();
      setManagedFrostFoxCatalog(null);
      setStatus((current) =>
        current
          ? { ...current, authenticated: false, account: undefined }
          : current,
      );
    } finally {
      setAction(null);
    }
  };

  const disconnect = async () => {
    setAction("disconnect");
    try {
      await disconnectFrostFox();
      setManagedFrostFoxCatalog(null);
      setStatus((current) =>
        current
          ? { ...current, authenticated: false, account: undefined }
          : current,
      );
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

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{account.name}</h3>
            <Badge variant={recoveryRequired ? "destructive" : "outline"}>
              {recoveryRequired
                ? t("settings.frostfox.reconnectRequired")
                : t("settings.frostfox.connected")}
            </Badge>
          </div>
          <p className="font-mono text-[10px] text-muted-foreground">
            {account.id}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label={t("settings.frostfox.refresh")}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            aria-hidden
          />
          {t("settings.frostfox.refresh")}
        </Button>
      </div>

      <dl className="grid grid-cols-2 border border-border">
        <div className="border-r border-border p-3">
          <dt className="text-[10px] text-muted-foreground">
            {t("settings.frostfox.balance")}
          </dt>
          <dd className="mt-1 text-sm font-medium tabular-nums">{balance}</dd>
        </div>
        <div className="p-3">
          <dt className="text-[10px] text-muted-foreground">
            {t("settings.frostfox.lastVerified")}
          </dt>
          <dd className="mt-1 text-xs">
            {new Intl.DateTimeFormat(i18n.language, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(account.lastVerifiedAt))}
          </dd>
        </div>
      </dl>

      {recoveryRequired && (
        <div className="border border-destructive/40 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
          {t("settings.frostfox.recoveryDescription")}
        </div>
      )}

      <div className="border-t border-border pt-4">
        {confirmDisconnect ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border border-destructive/40 bg-destructive/10 p-3">
            <p className="max-w-[48ch] text-xs leading-relaxed">
              {t("settings.frostfox.disconnectConfirm")}
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDisconnect(false)}
                disabled={action !== null}
              >
                {t("settings.frostfox.cancel")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void disconnect()}
                disabled={action !== null}
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
              className="text-destructive hover:text-destructive"
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
