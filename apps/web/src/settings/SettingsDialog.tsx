import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  Settings2,
  Sliders,
  Sparkles,
  Cpu,
  Layers,
  Palette,
  User,
  Database,
  Monitor,
  Key,
  Lock,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { isDesktopApp } from "@/lib/desktop-bridge.js";
import {
  buildNavTree,
  filterNav,
  APPEARANCE_NODE_ID,
  ACCOUNT_NODE_ID,
  OPERATOR_ACCESS_NODE_ID,
  PACKAGES_NODE_ID,
  type NavNode,
} from "./navigation.js";
import { SettingWidget } from "./widgets/index.js";
import { useSettingsStore } from "./use-settings.js";
import { DataPane } from "./DataPane.js";
import { DesktopPane } from "./DesktopPane.js";
import { LlmSlotsPane } from "./panes/LlmSlotsPane.js";
import { LlmAdvancedPane } from "./panes/LlmAdvancedPane.js";
import { PackagesPane } from "./panes/PackagesPane.js";
import { AppearancePane } from "./panes/AppearancePane.js";
import { OperatorAccessPane } from "./panes/OperatorAccessPane.js";
import { FrostFoxAccountPane } from "./panes/FrostFoxAccountPane.js";
import { useFrostFoxAccountOptional } from "@/components/frostfox-account-summary.js";
import { cn } from "@/lib/utils.js";
import { ShinyText } from "@/components/reactbits/index.js";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialKey?: string;
  /**
   * When set, restricts the view to only the tree rooted at this node (e.g.
   * `"llm.slots"` renders just that pane without the full sidebar nav).
   */
  focusNode?: string;
}

function getNodeIcon(id: string) {
  switch (id) {
    case "general":
      return Sliders;
    case "appearance":
      return Palette;
    case "account":
      return User;
    case "llm":
    case "llm.slots":
      return Cpu;
    case "plugin":
    case "packages":
      return Layers;
    case "data":
      return Database;
    case "desktop":
      return Monitor;
    default:
      return Sparkles;
  }
}

/**
 * SwitchPage Settings Dialog (Mobile-Responsive & Desktop)
 * On Desktop: 2-column sidebar + content with glassmorphism.
 * On Mobile: Horizontal swipeable category pill tabs + full-width content area.
 */
export function SettingsDialog({
  open,
  onOpenChange,
  initialKey,
  focusNode,
}: SettingsDialogProps) {
  const store = useSettingsStore();
  const { t, i18n } = useTranslation();
  const frostFoxAccount = useFrostFoxAccountOptional?.() ?? null;
  const hostedPlayerModelLocked = Boolean(
    frostFoxAccount?.status?.enabled &&
    frostFoxAccount.status.authenticated &&
    frostFoxAccount.status.account &&
    frostFoxAccount.status.account.isAdmin !== true,
  );
  const adminSettingsReadOnly = hostedPlayerModelLocked;
  const [query, setQuery] = useState("");
  const desktop = isDesktopApp();
  const [storeRevision, setStoreRevision] = useState(0);

  useEffect(
    () =>
      store.subscribeAll(() => {
        setStoreRevision((value) => value + 1);
      }),
    [store],
  );

  const tree = useMemo(
    () =>
      buildNavTree(store, { includeDesktop: desktop, locale: i18n.language }),
    [store, desktop, i18n.language, open, storeRevision],
  );
  const visibleTree = useMemo(() => {
    const scoped = focusNode
      ? tree.filter((node) => node.id === focusNode)
      : tree;
    return hostedPlayerModelLocked
      ? scoped.filter((node) => !isLlmNode(node.id))
      : scoped;
  }, [tree, focusNode, hostedPlayerModelLocked]);
  const filtered = useMemo(
    () => filterNav(visibleTree, query, i18n.language),
    [visibleTree, query, i18n.language],
  );

  const firstSelectable = useMemo(
    () => filtered.find((n) => n.id !== "llm" && n.id !== "plugin") ?? null,
    [filtered],
  );

  const [selected, setSelected] = useState<string>("");
  const contentRef = useRef<HTMLElement>(null);
  const selectionRequestRef = useRef<string | null>(null);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [selected]);

  useEffect(() => {
    if (!open) {
      selectionRequestRef.current = null;
      return;
    }

    const requestKey = initialKey ?? "";
    if (selectionRequestRef.current !== requestKey) {
      const exact = initialKey
        ? filtered.find((node) => node.id === initialKey)
        : undefined;
      const byChild = initialKey
        ? filtered.find((node) =>
            node.children.some(
              (entry) =>
                entry.key === initialKey || entry.key.startsWith(initialKey),
            ),
          )
        : undefined;
      const requested = exact && isSelectable(exact) ? exact : byChild;
      if (requested) {
        selectionRequestRef.current = requestKey;
        setSelected(requested.id);
        return;
      }
      if (!initialKey) {
        selectionRequestRef.current = requestKey;
        setSelected(firstSelectable?.id ?? "");
        return;
      }
    }

    if (!selected || !filtered.some((node) => node.id === selected)) {
      setSelected(firstSelectable?.id ?? "");
    }
  }, [open, initialKey, filtered, firstSelectable, selected]);

  const selectedNode: NavNode | null =
    filtered.find((n) => n.id === selected) ?? firstSelectable ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:w-[90vw] md:max-w-4xl h-[88vh] md:h-[82vh] p-0 gap-0 flex flex-col rounded-2xl md:rounded-3xl border border-white/15 bg-zinc-950/95 shadow-2xl backdrop-blur-2xl overflow-hidden text-foreground">
        {/* SwitchPage Dialog Header */}
        <DialogHeader className="px-4 sm:px-6 py-3.5 sm:py-4.5 border-b border-border/80 bg-card/40 flex-row items-center justify-between space-y-0 shrink-0">
          <DialogTitle className="flex items-center gap-2.5 sm:gap-3">
            <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
              <Settings2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <div>
              <span className="ui-eyebrow text-[9px] sm:text-[10px] text-muted-foreground font-mono tracking-widest block">
                § SETTINGS
              </span>
              <span className="text-sm sm:text-base font-semibold tracking-tight text-foreground">
                <ShinyText speed={5} shineColor="rgba(255, 255, 255, 0.8)">
                  {t("settings.title")}
                </ShinyText>
              </span>
            </div>
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("settings.title")}
          </DialogDescription>
        </DialogHeader>

        {/* Mobile Horizontal Category Tabs Bar (Visible on <md screens) */}
        {!focusNode && (
          <div className="md:hidden border-b border-border/80 bg-card/30 p-2 overflow-x-auto flex items-center gap-1.5 shrink-0 ui-scroll">
            {filtered
              .filter((node) => isSelectable(node))
              .map((node) => {
                const isSelected = selected === node.id;
                const Icon = getNodeIcon(node.id);
                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => setSelected(node.id)}
                    aria-current={isSelected ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs whitespace-nowrap font-medium transition-all shrink-0 cursor-pointer select-none",
                      isSelected
                        ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                        : "bg-muted/40 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{node.label}</span>
                  </button>
                );
              })}
          </div>
        )}

        {/* SwitchPage Body */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Desktop Left Sidebar (Visible on >=md screens) */}
          {!focusNode && (
            <aside className="hidden md:flex w-60 shrink-0 border-r border-border/80 bg-card/30 flex-col">
              {/* Search Box */}
              <div className="p-3.5 border-b border-border/60">
                <div className="relative flex items-center rounded-xl border border-border/80 bg-background/50 px-3 py-1.5 backdrop-blur-xs transition-all focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
                  <Search className="w-3.5 h-3.5 text-muted-foreground mr-2 shrink-0" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("settings.searchPlaceholder")}
                    className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground min-w-0"
                  />
                </div>
              </div>

              {/* Sidebar Switch Navigation Pills */}
              <nav className="flex-1 overflow-y-auto p-2.5 space-y-1 ui-scroll">
                {filtered.map((node) => {
                  const selectable = isSelectable(node);
                  const isHeader = node.kind === "group" && !selectable;
                  const isSelected = selected === node.id;
                  const Icon = getNodeIcon(node.id);

                  if (isHeader) {
                    return (
                      <div
                        key={node.id}
                        className="ui-eyebrow text-[10px] text-muted-foreground px-3 pt-3.5 pb-1 font-mono tracking-wider"
                      >
                        {node.label}
                      </div>
                    );
                  }

                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => setSelected(node.id)}
                      aria-current={isSelected ? "page" : undefined}
                      className={cn(
                        "group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium transition-all duration-200 cursor-pointer select-none",
                        isSelected
                          ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25 font-semibold"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground active:scale-[0.98]",
                      )}
                    >
                      <Icon
                        className={cn(
                          "w-3.5 h-3.5 shrink-0 transition-transform group-hover:scale-110",
                          isSelected
                            ? "text-primary-foreground"
                            : "text-muted-foreground",
                        )}
                      />
                      <span className="truncate">{node.label}</span>
                    </button>
                  );
                })}

                {filtered.length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                    {t("settings.noResults", { query })}
                  </div>
                )}
              </nav>
            </aside>
          )}

          {/* SwitchPage Content Area */}
          <section
            ref={contentRef}
            className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 ui-scroll bg-background/40"
          >
            <div className="max-w-2xl mx-auto animate-in fade-in-0 duration-300">
              {hostedPlayerModelLocked && !focusNode && (
                <ManagedModelNotice t={t} />
              )}
              {focusNode && hostedPlayerModelLocked && isLlmNode(focusNode) ? (
                <ManagedModelNotice t={t} />
              ) : (
                renderPane(selectedNode, t, adminSettingsReadOnly)
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function isLlmNode(id: string): boolean {
  return id === "llm" || id.startsWith("llm.");
}

function ManagedModelNotice({
  t,
}: {
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <div
      role="status"
      data-testid="managed-model-settings-notice"
      className="flex items-start gap-2 border border-primary/25 bg-primary/5 px-3 py-3 text-xs text-muted-foreground"
    >
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      <div className="space-y-1">
        <p className="font-medium text-foreground">
          {t("settings.managedModelSettingsTitle")}
        </p>
        <p className="leading-relaxed">
          {t("settings.managedModelSettingsDescription")}
        </p>
      </div>
    </div>
  );
}

/** Group headers ("llm", "plugin") are not directly selectable. */
function isSelectable(node: NavNode): boolean {
  if (node.id === "llm") return false;
  if (node.id === "plugin") return false;
  return true;
}

function renderPane(
  node: NavNode | null,
  t: (key: string, opts?: Record<string, unknown>) => string,
  adminSettingsReadOnly: boolean,
) {
  if (!node) {
    return (
      <div className="text-xs text-muted-foreground">
        {t("settings.noGroupSelected")}
      </div>
    );
  }
  if (node.id === "llm.slots") {
    return <LlmSlotsPane readOnly={adminSettingsReadOnly} />;
  }
  if (node.id === "llm.advanced") {
    return <LlmAdvancedPane readOnly={adminSettingsReadOnly} />;
  }
  if (node.id === "data") return <DataPane readOnly={adminSettingsReadOnly} />;
  if (node.id === "desktop") {
    return <DesktopPane readOnly={adminSettingsReadOnly} />;
  }
  if (node.id === APPEARANCE_NODE_ID) return <AppearancePane />;
  if (node.id === ACCOUNT_NODE_ID) return <FrostFoxAccountPane />;
  if (node.id === OPERATOR_ACCESS_NODE_ID) return <OperatorAccessPane />;
  if (node.id === PACKAGES_NODE_ID) {
    return <PackagesPane readOnly={adminSettingsReadOnly} />;
  }

  if (node.children.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        {t("settings.groupEmpty")}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {node.children.map((entry) => (
        <SettingWidget
          key={entry.key}
          entry={entry}
          readOnly={adminSettingsReadOnly}
        />
      ))}
    </div>
  );
}
