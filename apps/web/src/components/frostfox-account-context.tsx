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
  clearManagedFrostFoxSlots,
  fetchFrostFoxAccount,
  getManagedFrostFoxCatalog,
  hydrateManagedFrostFoxModels,
  reconcileManagedFrostFoxSlots,
  setManagedFrostFoxCatalog,
  type FrostFoxAccountStatus,
  type FrostFoxModelCatalog,
} from "@/services/api.js";

const REFRESH_INTERVAL_MS = 60_000;

type RefreshOptions = {
  readonly forceCatalog?: boolean;
};

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
    async ({ forceCatalog = false }: RefreshOptions = {}) => {
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

/** Hosted non-admin accounts use the administrator's model policy. */
export function frostFoxModelControlsLocked(
  status: FrostFoxAccountStatus | null | undefined,
): boolean {
  return Boolean(
    status?.enabled &&
    status.authenticated &&
    status.account &&
    status.account.isAdmin !== true,
  );
}
