import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CircleUserRound, WalletCards } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  fetchFrostFoxAccount,
  type FrostFoxAccountStatus,
} from "@/services/api.js";

const REFRESH_INTERVAL_MS = 60_000;

interface FrostFoxAccountContextValue {
  readonly status: FrostFoxAccountStatus | null;
  readonly loading: boolean;
  readonly error: boolean;
  readonly refresh: () => Promise<void>;
}

const FrostFoxAccountContext =
  createContext<FrostFoxAccountContextValue | null>(null);

export function FrostFoxAccountProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<FrostFoxAccountStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const next = await fetchFrostFoxAccount(true);
      if (mounted.current) setStatus(next);
    } catch {
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const interval = window.setInterval(
      () => void refresh(),
      REFRESH_INTERVAL_MS,
    );
    return () => {
      mounted.current = false;
      window.clearInterval(interval);
    };
  }, [refresh]);

  return (
    <FrostFoxAccountContext.Provider
      value={{ status, loading, error, refresh }}
    >
      {children}
    </FrostFoxAccountContext.Provider>
  );
}

export function useFrostFoxAccount(): FrostFoxAccountContextValue {
  const value = useContext(FrostFoxAccountContext);
  if (!value) {
    throw new Error("useFrostFoxAccount requires FrostFoxAccountProvider");
  }
  return value;
}

export function FrostFoxAccountSummary() {
  const { i18n, t } = useTranslation();
  const { status } = useFrostFoxAccount();

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
      <div className="hidden h-9 max-w-36 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-xs sm:flex">
        <CircleUserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{status.account.name}</span>
      </div>
      <div className="flex h-9 items-center gap-1 rounded-[var(--radius-control)] px-2 text-xs tabular-nums">
        <WalletCards className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{balance}</span>
      </div>
    </div>
  );
}
