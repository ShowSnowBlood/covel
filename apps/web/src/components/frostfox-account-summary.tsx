import { useEffect, useState } from "react";
import { CircleUserRound, Loader2, WalletCards } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  fetchFrostFoxAccount,
  type FrostFoxAccountStatus,
} from "@/services/api.js";

const REFRESH_INTERVAL_MS = 60_000;

export function FrostFoxAccountSummary() {
  const { i18n, t } = useTranslation();
  const [status, setStatus] = useState<FrostFoxAccountStatus | null>(null);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      try {
        const next = await fetchFrostFoxAccount(true);
        if (active) setStatus(next);
      } catch {
        // The header should not block the application when account status is unavailable.
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  if (!status?.enabled) return null;

  if (!status.authenticated || !status.account) {
    return (
      <button
        type="button"
        onClick={() => window.location.assign("/auth/frostfox/start")}
        aria-label={t("nav.frostfoxConnect", "Connect account")}
        className="flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-primary"
      >
        <CircleUserRound className="h-4 w-4" aria-hidden="true" />
        <span className="hidden text-[11px] font-medium sm:inline">
          {t("nav.frostfoxConnect", "Connect account")}
        </span>
      </button>
    );
  }

  const balance = new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency: "USD",
  }).format(status.account.balance);

  return (
    <div
      className="flex items-center gap-1.5 text-muted-foreground"
      aria-label={t("nav.frostfoxAccountSummary", "Account and balance")}
    >
      <div className="flex h-9 max-w-36 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-xs">
        <CircleUserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="hidden truncate sm:inline">{status.account.name}</span>
      </div>
      <div className="flex h-9 items-center gap-1 rounded-[var(--radius-control)] px-2 text-xs tabular-nums">
        <WalletCards className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{balance}</span>
      </div>
    </div>
  );
}

export function FrostFoxAccountLoading() {
  return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />;
}
