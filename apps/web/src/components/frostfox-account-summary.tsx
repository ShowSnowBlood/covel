import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  KeyRound,
  LogOut,
  RefreshCw,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { FrostFoxConnectDialog } from "@/components/frostfox-connect-dialog.js";
import {
  clearManagedFrostFoxSlots,
  fetchFrostFoxAccount,
  getManagedFrostFoxCatalog,
  hydrateManagedFrostFoxModels,
  reconcileManagedFrostFoxSlots,
  setManagedFrostFoxCatalog,
  signOutFrostFox,
  type FrostFoxAccountStatus,
  type FrostFoxModelCatalog,
} from "@/services/api.js";
import { SettingsDialog } from "@/settings/SettingsDialog.js";

const REFRESH_INTERVAL_MS = 60_000;

export interface FrostFoxAccountContextValue {
  readonly status: FrostFoxAccountStatus | null;
  readonly catalog: FrostFoxModelCatalog | null;
  readonly loading: boolean;
  readonly error: boolean;
  readonly refresh: () => Promise<void>;
  readonly refreshModels: () => Promise<void>;
}

const FrostFoxAccountContext =
  createContext<FrostFoxAccountContextValue | null>(null);

export function FrostFoxAccountProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<FrostFoxAccountStatus | null>(null);
  const [catalog, setCatalog] = useState<FrostFoxModelCatalog | null>(() =>
    getManagedFrostFoxCatalog(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const mounted = useRef(true);
  const refreshVersion = useRef(0);
  const activeAccountId = useRef<string | null | undefined>(undefined);
  const hydratedAccountId = useRef<string | null | undefined>(undefined);

  const refresh = useCallback(
    async ({ forceCatalog = false }: { forceCatalog?: boolean } = {}) => {
      const requestVersion = ++refreshVersion.current;
      if (forceCatalog) hydratedAccountId.current = undefined;
      setLoading(true);
      setError(false);
      try {
        const next = await fetchFrostFoxAccount(true);
        if (!mounted.current || requestVersion !== refreshVersion.current)
          return;
        const nextAccountId =
          next.authenticated && next.account ? next.account.id : null;
        const accountChanged = activeAccountId.current !== nextAccountId;
        if (accountChanged && activeAccountId.current !== undefined) {
          setManagedFrostFoxCatalog(null);
          clearManagedFrostFoxSlots();
          setCatalog(null);
        }
        if (accountChanged) hydratedAccountId.current = undefined;
        activeAccountId.current = nextAccountId;
        setStatus(next);

        let hydratedCatalog = getManagedFrostFoxCatalog();
        if (next.enabled && next.authenticated && next.account) {
          // Model discovery is account-scoped. Balance/status refreshes may run
          // periodically, but they must not re-read the model directory.
          if (forceCatalog || hydratedAccountId.current !== nextAccountId) {
            hydratedCatalog = await hydrateManagedFrostFoxModels(
              next,
              forceCatalog,
            );
            hydratedAccountId.current = nextAccountId;
          }
          reconcileManagedFrostFoxSlots();
        } else {
          hydratedAccountId.current = null;
          if (hydratedCatalog !== null) setManagedFrostFoxCatalog(null);
          clearManagedFrostFoxSlots();
          hydratedCatalog = null;
        }
        if (!mounted.current || requestVersion !== refreshVersion.current)
          return;
        setCatalog(hydratedCatalog ?? getManagedFrostFoxCatalog());
      } catch {
        if (mounted.current && requestVersion === refreshVersion.current) {
          // A transient account-status failure must not discard the catalog that
          // was already loaded for this login.
          setError(true);
        }
      } finally {
        if (mounted.current && requestVersion === refreshVersion.current) {
          setLoading(false);
        }
      }
    },
    [],
  );

  const refreshModels = useCallback(async () => {
    await refresh({ forceCatalog: true });
  }, [refresh]);

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
      value={{ status, catalog, loading, error, refresh, refreshModels }}
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

export function useFrostFoxAccountOptional(): FrostFoxAccountContextValue | null {
  return useContext(FrostFoxAccountContext);
}
export function FrostFoxAccountSummary({
  overlay = false,
}: {
  readonly overlay?: boolean;
}) {
  const { i18n, t } = useTranslation();
  const { status, refresh } = useFrostFoxAccount();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    if (!popoverOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setPopoverOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [popoverOpen]);

  const handleManualRefresh = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleCopyId = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard write failed
    }
  };

  const handleSignOut = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOutFrostFox();
      setManagedFrostFoxCatalog(null);
      clearManagedFrostFoxSlots();
      setPopoverOpen(false);
      // Refresh after logout. Besides publishing the unauthenticated state,
      // refresh() advances the provider generation and invalidates any
      // periodic request that was still in flight when logout began.
      await refresh();
    } finally {
      setSigningOut(false);
    }
  };

  const handleOpenSettings = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPopoverOpen(false);
    setSettingsOpen(true);
  };

  const handleSwitchAccount = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPopoverOpen(false);
    window.location.assign("/auth/frostfox/start");
  };

  if (!status?.enabled) return null;

  if (!status.authenticated || !status.account) {
    return (
      <>
        <button
          type="button"
          onClick={() => setConnectDialogOpen(true)}
          aria-label={t("nav.frostfoxConnect", "Connect Account")}
          className={`group relative flex h-8.5 items-center gap-2 rounded-full px-3 text-xs font-semibold backdrop-blur-md transition-all duration-200 border cursor-pointer select-none active:scale-[0.98] ${
            overlay
              ? "bg-white/10 hover:bg-white/20 active:bg-white/25 border-white/20 hover:border-white/35 text-white shadow-lg shadow-black/20"
              : "bg-primary/10 hover:bg-primary/20 text-primary border-primary/25 hover:border-primary/40 dark:bg-white/10 dark:hover:bg-white/20 dark:text-white dark:border-white/20 shadow-xs"
          }`}
        >
          <Sparkles
            className="h-3.5 w-3.5 shrink-0 opacity-80 group-hover:scale-110 transition-transform"
            aria-hidden="true"
          />
          <span>{t("nav.frostfoxConnect", "Connect Account")}</span>
        </button>

        <FrostFoxConnectDialog
          open={connectDialogOpen}
          onOpenChange={setConnectDialogOpen}
        />
      </>
    );
  }

  const account = status.account;
  const recoveryRequired = account.credentialState === "recovery_required";
  const initialChar = account.name.trim().charAt(0).toUpperCase() || "U";

  const balance = new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency: "USD",
  }).format(account.balance);

  return (
    <div className="relative inline-block" ref={containerRef}>
      {/* Interactive Account Capsule Trigger */}
      <button
        type="button"
        onClick={() => setPopoverOpen((prev) => !prev)}
        aria-expanded={popoverOpen}
        aria-haspopup="dialog"
        aria-label={t("nav.frostfoxAccountSummary", "Account and balance")}
        className={`group flex h-8.5 items-center gap-2 rounded-full pl-1.5 pr-2.5 text-xs transition-all duration-200 border cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
          overlay
            ? popoverOpen
              ? "bg-zinc-900/90 border-white/35 text-white shadow-xl shadow-black/40 ring-1 ring-white/20"
              : "bg-zinc-900/65 hover:bg-zinc-900/85 backdrop-blur-xl border-white/15 hover:border-white/30 text-[#f4f0e5] shadow-lg shadow-black/25 ring-1 ring-white/5"
            : popoverOpen
              ? "bg-card border-primary/40 text-foreground shadow-md ring-1 ring-primary/20"
              : "bg-secondary/60 hover:bg-secondary/90 backdrop-blur-sm border-border/80 hover:border-border text-foreground shadow-xs ring-1 ring-black/5 dark:ring-white/5"
        }`}
      >
        {/* Avatar with Status Dot */}
        <div className="relative flex h-6 w-6 items-center justify-center rounded-full font-bold text-[10.5px] bg-gradient-to-br from-primary/20 via-primary/10 to-primary/5 text-primary border border-primary/25 dark:from-white/20 dark:via-white/10 dark:to-white/5 dark:text-white dark:border-white/20 shrink-0 select-none">
          <span>{initialChar}</span>
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ${
              overlay ? "ring-zinc-900" : "ring-card"
            } ${
              recoveryRequired ? "bg-amber-500 animate-pulse" : "bg-emerald-500"
            }`}
            aria-hidden="true"
          />
        </div>

        {/* Account Name */}
        <span className="hidden sm:inline font-semibold text-xs tracking-tight truncate max-w-[100px] md:max-w-[130px]">
          {account.name}
        </span>

        {/* Vertical Divider */}
        <span
          className={`hidden sm:inline h-3.5 w-px ${
            overlay ? "bg-white/20" : "bg-border"
          }`}
          aria-hidden="true"
        />

        {/* Balance Section */}
        <div className="flex items-center gap-1.5 font-mono font-medium text-xs tabular-nums">
          <WalletCards
            className="h-3.5 w-3.5 shrink-0 opacity-75 group-hover:scale-105 transition-transform"
            aria-hidden="true"
          />
          <span className="font-semibold tracking-tight">{balance}</span>
        </div>

        {/* Dropdown Chevron */}
        <ChevronDown
          className={`h-3 w-3 shrink-0 opacity-50 transition-transform duration-200 ${
            popoverOpen ? "rotate-180 opacity-90" : "group-hover:opacity-80"
          }`}
          aria-hidden="true"
        />
      </button>

      {/* Account Popover Menu */}
      {popoverOpen && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={t("nav.frostfoxAccountSummary", "Account and balance")}
          className="absolute right-0 top-full mt-2 w-[min(calc(100vw-1.5rem),340px)] rounded-2xl border border-border/80 dark:border-white/15 bg-card/95 dark:bg-zinc-950/95 shadow-2xl shadow-black/40 backdrop-blur-2xl p-4 text-foreground z-50 animate-in fade-in-0 zoom-in-95 duration-150 space-y-3.5"
        >
          {/* Profile Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold text-sm bg-gradient-to-br from-primary/20 via-primary/10 to-primary/5 text-primary border border-primary/25 dark:from-white/20 dark:via-white/10 dark:to-white/5 dark:text-white dark:border-white/20 select-none shadow-sm">
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
              <div className="min-w-0">
                <h4 className="truncate text-sm font-bold tracking-tight text-foreground">
                  {account.name}
                </h4>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className="truncate font-mono text-[10.5px] text-muted-foreground max-w-[150px]"
                    title={account.id}
                  >
                    {account.id}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => void handleCopyId(account.id, e)}
                    aria-label={t("account.copyId", "Copy Account ID")}
                    className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded cursor-pointer"
                    title={
                      copied
                        ? t("account.idCopied", "Copied to clipboard")
                        : t("account.copyId", "Copy Account ID")
                    }
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

            {/* Connection Status Badge */}
            <div
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                recoveryRequired
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25"
                  : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25"
              }`}
            >
              {recoveryRequired ? (
                <ShieldAlert className="h-3 w-3" />
              ) : (
                <ShieldCheck className="h-3 w-3" />
              )}
              <span>
                {recoveryRequired
                  ? t("account.recoveryRequired", "Reconnect Required")
                  : t("account.connected", "Connected")}
              </span>
            </div>
          </div>

          {/* Balance Card */}
          <div className="rounded-xl border border-border/60 dark:border-white/10 bg-muted/40 dark:bg-zinc-900/60 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                <WalletCards className="h-3.5 w-3.5 text-primary dark:text-zinc-200" />
                {t("account.balance", "Router Balance")}
              </span>
              <button
                type="button"
                onClick={(e) => void handleManualRefresh(e)}
                disabled={refreshing}
                aria-label={t("account.refreshBalance", "Refresh Balance")}
                className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted/60 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3 w-3 ${refreshing ? "animate-spin text-primary" : ""}`}
                  aria-hidden="true"
                />
                <span className="hidden min-[360px]:inline">
                  {t("account.refreshBalance", "Refresh")}
                </span>
              </button>
            </div>

            <div className="flex items-baseline justify-between pt-0.5">
              <div className="font-mono text-xl font-bold tracking-tight text-foreground tabular-nums">
                {balance}
              </div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground bg-muted/80 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                USD
              </span>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[10px] text-muted-foreground">
              <span>{t("account.lastVerified", "Last Verified")}</span>
              <span className="font-mono">
                {new Intl.DateTimeFormat(i18n.language, {
                  dateStyle: "short",
                  timeStyle: "short",
                }).format(new Date(account.lastVerifiedAt))}
              </span>
            </div>
          </div>

          {/* Recovery Alert if needed */}
          {recoveryRequired && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div className="space-y-1.5 flex-1">
                <p className="text-[11px] leading-relaxed">
                  {t(
                    "settings.frostfox.recoveryDescription",
                    "Router could not verify the current account Key. Reconnect the account to restore access.",
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => window.location.assign("/auth/frostfox/start")}
                  className="text-xs font-semibold underline hover:no-underline text-amber-800 dark:text-amber-200 cursor-pointer"
                >
                  {t("account.reconnect", "Reconnect")}
                </button>
              </div>
            </div>
          )}

          {/* Actions Menu */}
          <div className="pt-1 space-y-1">
            <button
              type="button"
              onClick={handleOpenSettings}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 dark:hover:bg-zinc-900/70 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Settings2 className="h-3.5 w-3.5 text-primary" />
                {t("account.settings", "Account Settings")}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                § SETTINGS
              </span>
            </button>

            <button
              type="button"
              onClick={handleSwitchAccount}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 dark:hover:bg-zinc-900/70 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <ExternalLink className="h-3.5 w-3.5 text-primary" />
                {t("account.switchAccount", "Switch Account")}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                § SWITCH
              </span>
            </button>

            <button
              type="button"
              onClick={(e) => void handleSignOut(e)}
              disabled={signingOut}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-destructive/90 hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer disabled:opacity-50"
            >
              <span className="flex items-center gap-2">
                {signingOut ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <LogOut className="h-3.5 w-3.5" />
                )}
                {t("account.signOut", "Sign Out")}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Settings Dialog when opened via Account menu */}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialKey="account"
      />
    </div>
  );
}
