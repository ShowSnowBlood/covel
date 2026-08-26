import {
  createRootRoute,
  Link,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { FrostFoxAccountSummary } from "@/components/frostfox-account-summary";
import { ToastHost } from "@/components/ui/toast-host";
import { ConfirmHost } from "@/components/ui/confirm-host";
import { AppErrorBoundary } from "@/components/error-boundary";
import { useLocalePreference } from "@/hooks/useLocalePreference";
import { getCovelIpc } from "@/lib/desktop-bridge";
import { useSession } from "@/stores/session-store";
import { emitNavEvent } from "@/lib/nav-events";
import { SceneLoadingTransition } from "@/components/visual-effects/SceneLoadingTransition.js";
import { worldVisual } from "@/lib/world-visuals.js";

export const Route = createRootRoute({
  component: RootLayout,
});

const dragStyle: CSSProperties = { WebkitAppRegion: "drag" } as CSSProperties;
const noDragStyle: CSSProperties = {
  WebkitAppRegion: "no-drag",
} as CSSProperties;

function RootLayout() {
  const { t } = useTranslation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { locale, setLocale } = useLocalePreference();
  const location = useLocation();
  useEffect(() => {
    document.title = "FrostFox Game";
  }, [location.pathname]);
  const navigate = useNavigate();
  const isSessionRoute = location.pathname.startsWith("/session");
  const isDebugRoute = location.pathname.startsWith("/debug");
  const isSession = isSessionRoute || isDebugRoute;
  const isHome = location.pathname === "/";
  const showRouterDevtools = !isSessionRoute && !isDebugRoute;

  // Carry the active session id between Studio (/session) and Debugger (/debug)
  // so flipping tabs preserves what the user is inspecting. /session has stale-
  // session logic that drops state when it loads without a sid; without this,
  // clicking Studio from /debug would always boot the user back to world-select.
  //
  // /debug doesn't restore the session into SessionProvider, so we must also
  // honour `?sid=` already in the URL. The session-store value takes priority
  // (matches the Studio's authoritative state); the URL is a read-only fallback.
  const { state: sessionState, backToWorldSelect } = useSession();
  const urlSid = (() => {
    const search = location.search as unknown;
    if (typeof search === "string") {
      const v = new URLSearchParams(search).get("sid");
      return v && v.length > 0 ? v : null;
    }
    if (search && typeof search === "object") {
      const v = (search as Record<string, unknown>).sid;
      return typeof v === "string" && v.length > 0 ? v : null;
    }
    return null;
  })();
  const activeSid = sessionState.session?.id ?? urlSid;
  const hasSession = sessionState.session !== null;
  const navSearch = activeSid ? { sid: activeSid } : {};
  const sessionSearch = activeSid ? { sid: activeSid } : {};

  // Active state for the primary nav. The tabs map to the world, session,
  // plugin, and image surfaces.
  type NavId = "home" | "world" | "session" | "plugins" | "images";
  const activeNav: NavId | null = (() => {
    if (isHome) return "home";
    if (isSessionRoute) {
      if (!hasSession) return "world";
      return "session";
    }
    return null;
  })();

  const [navTransition, setNavTransition] = useState<{
    image?: string;
    title?: string;
    subtitle?: string;
    steps?: string[];
    onComplete: () => void;
  } | null>(null);

  const goHome = () => {
    if (isHome) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      navigate({ to: "/" });
      return;
    }
    setNavTransition({
      image: "/visuals/backgrounds/frostfox-game-cover-image2.png",
      title: t("home.gameTitle", "FrostFox Game"),
      subtitle: t("transition.returningHome"),
      steps: [
        t("transition.saveState"),
        t("transition.unloadPipeline"),
        t("transition.returnHome"),
      ],
      onComplete: () => {
        setNavTransition(null);
        navigate({ to: "/" });
      },
    });
  };
  const goWorld = () => {
    if (!hasSession && !sessionState.world && isSessionRoute) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (sessionState.session) backToWorldSelect();
      navigate({ to: "/session", search: {} });
      return;
    }
    const visual = sessionState.world ? worldVisual(sessionState.world) : null;
    setNavTransition({
      image: visual?.image ?? "/visuals/backgrounds/home-hero.webp",
      title: t("session.breadcrumbWorldSelect", "选择世界"),
      subtitle: t("transition.returningWorldSelect"),
      steps: [
        t("transition.saveSession"),
        t("transition.loadArchives"),
        t("transition.readyWorldSelect"),
      ],
      onComplete: () => {
        setNavTransition(null);
        if (sessionState.session) backToWorldSelect();
        navigate({ to: "/session", search: {} });
      },
    });
  };
  const goSession = () => navigate({ to: "/session", search: sessionSearch });
  const goPlugins = () => {
    navigate({ to: "/session", search: sessionSearch });
    emitNavEvent("open-plugins");
  };
  const goImages = () => {
    navigate({ to: "/session", search: sessionSearch });
    emitNavEvent("open-images");
  };

  const navItems: Array<{
    id: NavId;
    label: string;
    onClick: () => void;
    disabled?: boolean;
  }> = [
    { id: "home", label: t("nav.home", "Home"), onClick: goHome },
    { id: "world", label: t("nav.world", "World"), onClick: goWorld },
    {
      id: "session",
      label: t("nav.session", "Session"),
      onClick: goSession,
      disabled: !hasSession,
    },
    {
      id: "plugins",
      label: t("nav.plugins", "Plugins"),
      onClick: goPlugins,
      disabled: !hasSession,
    },
    {
      id: "images",
      label: t("nav.images", "Images"),
      onClick: goImages,
      disabled: !hasSession,
    },
  ];

  // Electron hides the native title bar so the in-app header can follow the
  // active theme. On macOS we pad-left to clear the inset traffic lights.
  const ipc = getCovelIpc();
  const isElectron = ipc !== null;
  const isMacDesktop = isElectron && ipc?.platform === "darwin";

  const toggleLocale = () => {
    setLocale(locale === "zh-CN" ? "en-US" : "zh-CN");
  };

  return (
    <>
      <ToastHost />
      <ConfirmHost />
      <div className="h-screen w-full bg-background text-foreground font-sans selection:bg-primary selection:text-primary-foreground flex flex-col overflow-hidden">
        <header
          className={`z-50 transition-all ${
            isHome
              ? "absolute inset-x-0 top-0 h-16 border-transparent bg-transparent text-[#f4f0e5]"
              : `ui-panel-header relative flex-shrink-0 border-b border-border/80 backdrop-blur-md ${isSession ? "h-12" : "h-16"}`
          }`}
          style={isElectron ? dragStyle : undefined}
        >
          {!isHome && (
            <Link
              to="/"
              onClick={(e) => {
                e.preventDefault();
                goHome();
              }}
              className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ui-title flex items-center gap-2 tracking-tight pointer-events-auto transition-transform hover:scale-105 ${isSession ? "text-sm sm:text-base" : "text-base sm:text-xl font-bold"}`}
              style={isElectron ? noDragStyle : undefined}
            >
              <img
                src="/icon.png?v=frostfox-game"
                alt=""
                aria-hidden="true"
                className={`rounded-lg object-cover shadow-sm ${isSession ? "h-5 w-5 sm:h-6 sm:w-6" : "h-6 w-6 sm:h-7 sm:w-7"}`}
                draggable={false}
              />
              <span className="font-display font-bold tracking-tight text-foreground hidden min-[420px]:inline">
                FrostFox Game
              </span>
            </Link>
          )}
          <div
            className={`w-full flex h-full items-center justify-between ${isMacDesktop ? "pl-[88px] pr-3 sm:pr-6" : "px-2.5 sm:px-6"}`}
          >
            {!isHome && (
              <nav
                className="hidden md:flex items-center gap-1 text-xs font-medium"
                style={isElectron ? noDragStyle : undefined}
                aria-label={t("nav.primary", "Primary")}
              >
                {navItems.map((item) => {
                  const isActive = activeNav === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={item.onClick}
                      disabled={item.disabled}
                      aria-current={isActive ? "page" : undefined}
                      className={`relative h-8 px-3 transition-colors rounded-[var(--radius-control)] ${
                        isActive
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      } ${
                        item.disabled
                          ? "text-muted-foreground/75 cursor-not-allowed hover:text-muted-foreground/75"
                          : ""
                      }`}
                    >
                      <span>{item.label}</span>
                      {isActive && (
                        <span
                          aria-hidden
                          className="absolute left-2 right-2 -bottom-[1px] h-[2px] bg-[var(--accent-primary)]"
                        />
                      )}
                    </button>
                  );
                })}
              </nav>
            )}
            <div
              className="flex items-center gap-1 md:gap-1.5 ml-auto"
              style={isElectron ? noDragStyle : undefined}
            >
              {!isHome && <ThemeToggle />}
              <FrostFoxAccountSummary overlay={isHome} />
              {!isHome && (
                <>
                  <button
                    onClick={toggleLocale}
                    aria-label={
                      locale === "zh-CN"
                        ? t("onboarding.localeEn", "Switch to English")
                        : t("onboarding.localeZh", "Switch to Chinese")
                    }
                    className="hidden md:flex items-center justify-center h-9 min-w-9 px-2.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-primary hover:bg-muted/40 transition-colors rounded-[var(--radius-control)]"
                  >
                    {locale === "zh-CN" ? "EN" : "ZH"}
                  </button>
                  {!isSession && (
                    <Button
                      variant="default"
                      asChild
                      className="hidden md:flex h-9 ml-1.5 px-4 text-[11px] font-semibold uppercase tracking-widest rounded-[var(--radius-control)]"
                    >
                      <Link to="/session">
                        {t("nav.getStarted", "Get Started")}
                      </Link>
                    </Button>
                  )}
                  <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                    <DialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("nav.primary", "Primary")}
                        className="md:hidden h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/50"
                      >
                        <Menu className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="w-[88vw] max-w-xs rounded-3xl p-5 bg-card/95 backdrop-blur-2xl border border-border/80 shadow-2xl">
                      <DialogHeader className="pb-3 border-b border-border/60">
                        <DialogTitle className="text-sm font-semibold tracking-wider uppercase font-mono text-muted-foreground">
                          {t("nav.primary", "Primary")}
                        </DialogTitle>
                      </DialogHeader>
                      <nav className="flex flex-col gap-1 pt-2">
                        {navItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            disabled={item.disabled}
                            aria-current={
                              activeNav === item.id ? "page" : undefined
                            }
                            onClick={() => {
                              setMobileNavOpen(false);
                              item.onClick();
                            }}
                            className={`h-12 px-3.5 text-left text-sm font-medium transition-all rounded-2xl flex items-center justify-between cursor-pointer ${
                              activeNav === item.id
                                ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                                : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                            } ${item.disabled ? "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground" : ""}`}
                          >
                            <span>{item.label}</span>
                            {activeNav === item.id && (
                              <span className="h-2 w-2 rounded-full bg-primary-foreground" />
                            )}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            setMobileNavOpen(false);
                            toggleLocale();
                          }}
                          className="h-12 px-3.5 mt-2 border-t border-border/60 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors flex items-center justify-between cursor-pointer"
                        >
                          <span>
                            {locale === "zh-CN"
                              ? t("onboarding.localeEn", "Switch to English")
                              : t("onboarding.localeZh", "Switch to Chinese")}
                          </span>
                          <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-muted text-foreground">
                            {locale === "zh-CN" ? "EN" : "ZH"}
                          </span>
                        </button>
                      </nav>
                    </DialogContent>
                  </Dialog>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 flex flex-col w-full min-h-0 overflow-hidden relative">
          <AppErrorBoundary>
            <Outlet />
          </AppErrorBoundary>
        </main>

        {!isHome && (
          <footer
            className={`ui-panel-footer flex-shrink-0 border-t border-border transition-all ${isSession ? "py-1.5" : "py-8"}`}
          >
            <div
              className={`w-full px-4 md:px-6 flex items-center justify-between ${isSession ? "gap-2" : "flex-col md:flex-row gap-6"}`}
            >
              <div
                className={`ui-title flex items-center gap-2 font-medium ${isSession ? "text-xs" : "text-sm"}`}
              >
                <span
                  className={`rounded-full border border-primary/50 bg-primary/20 ${isSession ? "h-2 w-2" : "h-2.5 w-2.5"}`}
                ></span>
                <span>FrostFox Studio</span>
              </div>
              <div
                className={`ui-eyebrow text-muted-foreground ${isSession ? "text-[10px]" : "text-xs"}`}
              >
                &copy; {new Date().getFullYear()} FrostFox Framework.
              </div>
            </div>
          </footer>
        )}
      </div>
      {import.meta.env.DEV &&
        showRouterDevtools &&
        import.meta.env.VITE_ROUTER_DEVTOOLS !== "false" && (
          <TanStackRouterDevtools position="bottom-right" />
        )}
      {navTransition && (
        <SceneLoadingTransition
          image={navTransition.image}
          title={navTransition.title}
          subtitle={navTransition.subtitle}
          steps={navTransition.steps}
          onComplete={navTransition.onComplete}
        />
      )}
    </>
  );
}
