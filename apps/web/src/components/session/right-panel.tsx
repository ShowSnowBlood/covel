import { useState, useEffect, useMemo, useRef, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Database, BookOpen, HelpCircle, type LucideIcon } from "lucide-react";
import * as Icons from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.js";
import { ScrollArea } from "@/components/ui/scroll-area.js";
import { WorldDocumentPanel } from "./world-document-panel.js";
import { PluginPanel } from "./plugin-panel.js";
import type { PluginPanelStateCache } from "./plugin-panel.js";
import { DatabasePanel } from "./database-panel.js";
import {
  fetchUiSpecs,
  listPluginData,
  type WorldRecord,
} from "@/services/api.js";
import { loadPluginData } from "@/stores/plugin-data-store.js";
import {
  aggregateSpecsIntoGroups,
  compactTabLabel,
  groupShortLabel,
  panelProviderLabel,
  planPluginPanelProviders,
  type PluginPanelTabGroup,
} from "@/lib/plugin-panel-tabs.js";
import { useSession } from "@/stores/session-store.js";
import { onNavEvent } from "@/lib/nav-events.js";
import { ignoreError } from "@/lib/ignore-error.js";
import { useMediaQuery } from "@/hooks/use-media-query.js";
import { cn } from "@/lib/utils.js";

interface RightPanelTabItem {
  id: string;
  value: string;
  label: string;
  shortLabel?: string;
  icon: LucideIcon;
  title?: string;
}

function resolvePluginIcon(name: string): Icons.LucideIcon {
  const pascal = name
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
  const resolved = (Icons as Record<string, unknown>)[pascal] as
    Icons.LucideIcon | undefined;
  if (resolved) return resolved;
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn(
      `[right-panel] unknown lucide icon "${name}" (looked up as "${pascal}") — falling back to HelpCircle`,
    );
  }
  return HelpCircle;
}

export interface RightPanelProps {
  sessionId: string;
  /** Currently loaded world — its `lore` (WORLD.md) is rendered in the right-panel "World" tab. */
  world: WorldRecord | null;
  /** State change patches used as a freshness signal for the DB tab. */
  statePatches: Array<{ id: string }>;
  /** A mobile topbar request, retained until plugin tabs finish loading. */
  requestedEvent?: {
    event: "open-images" | "open-database";
    sequence: number;
  } | null;
}

export function RightPanel({
  sessionId,
  world,
  statePatches,
  requestedEvent,
}: RightPanelProps): ReactElement {
  const { t, i18n } = useTranslation();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const pluginPanelStateCacheRef = useRef<PluginPanelStateCache>(new Map());
  const [pluginTabGroups, setPluginTabGroups] = useState<PluginPanelTabGroup[]>(
    [],
  );
  const [activePluginSubTab, setActivePluginSubTab] = useState<
    Record<string, number>
  >({});
  const [activeTab, setActiveTab] = useState("world");
  const { state: sessionState } = useSession();
  const activePluginKey = useMemo(
    () =>
      sessionState.sessionPlugins
        .filter((plugin) => plugin.isActive)
        .map((plugin) => plugin.id)
        .sort()
        .join("\u001f"),
    [sessionState.sessionPlugins],
  );

  // Plugin panel state stores are local UI state (collapse/toggle selections),
  // not session data. Reset them with the session so a tab from the previous
  // session cannot remain selected and render stale controls in the new one.
  useEffect(() => {
    setActiveTab("world");
    setActivePluginSubTab({});
    pluginPanelStateCacheRef.current.clear();
  }, [sessionId]);

  const tabItems = useMemo<RightPanelTabItem[]>(
    () => [
      {
        id: "world",
        value: "world",
        label: t("session.worldTab"),
        icon: BookOpen,
      },
      {
        id: "database",
        value: "database",
        label: t("session.database"),
        icon: Database,
      },
      ...pluginTabGroups.map((group) => ({
        id: group.id,
        value: `plugin-${group.id}`,
        label: group.label,
        shortLabel: groupShortLabel(group),
        icon: resolvePluginIcon(group.icon),
      })),
    ],
    [pluginTabGroups, t],
  );

  // Global header navigation shortcut listener
  useEffect(() => {
    return onNavEvent((event) => {
      if (event === "open-plugins") {
        const first = pluginTabGroups[0];
        if (first) setActiveTab(`plugin-${first.id}`);
      } else if (event === "open-images") {
        const imageTab = pluginTabGroups.find(
          (g) =>
            g.id.includes("image") ||
            g.id.includes("gallery") ||
            g.id.includes("portrait"),
        );
        if (imageTab) setActiveTab(`plugin-${imageTab.id}`);
      }
    });
  }, [pluginTabGroups]);

  // A topbar event can arrive before the async UI-spec request has populated
  // plugin groups. Replay the request whenever that list changes.
  useEffect(() => {
    if (!requestedEvent) return;
    if (requestedEvent.event === "open-database") {
      setActiveTab("database");
      return;
    }
    const imageTab = pluginTabGroups.find(
      (g) =>
        g.id.includes("image") ||
        g.id.includes("gallery") ||
        g.id.includes("portrait"),
    );
    if (imageTab) setActiveTab(`plugin-${imageTab.id}`);
  }, [pluginTabGroups, requestedEvent]);

  // Load right-rail UI specs
  useEffect(() => {
    let cancelled = false;
    fetchUiSpecs(sessionId)
      .then((specs) => {
        if (cancelled) return;
        setPluginTabGroups(
          aggregateSpecsIntoGroups(specs.right, i18n.language, {
            warn: (message) => {
              if (import.meta.env.DEV) {
                // eslint-disable-next-line no-console
                console.warn(message);
              }
            },
          }),
        );

        const pluginIds = new Set(specs.right.map((entry) => entry.pluginId));
        for (const pid of pluginIds) {
          listPluginData(sessionId, pid)
            .then((items) => {
              if (cancelled) return;
              const byNamespace = new Map<
                string,
                Array<{ key: string; value: unknown }>
              >();
              for (const item of items) {
                const list = byNamespace.get(item.namespace) ?? [];
                list.push({ key: item.key, value: item.value });
                byNamespace.set(item.namespace, list);
              }
              for (const [ns, rows] of byNamespace.entries()) {
                loadPluginData(pid, ns, rows);
              }
            })
            .catch(ignoreError(`load initial data for ${pid}`));
        }
      })
      .catch(ignoreError("fetch right panel ui-specs"));

    return () => {
      cancelled = true;
    };
  }, [sessionId, activePluginKey, i18n.language]);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-background text-foreground">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className={cn(
          "flex-1 flex min-h-0 min-w-0",
          isMobile ? "flex-col" : "flex-row",
        )}
        orientation={isMobile ? "horizontal" : "vertical"}
      >
        {/* Navigation Rail / Header Bar */}
        {isMobile ? (
          /* Mobile Horizontal Tab Scroller */
          <div className="border-b border-border/80 bg-card/75 backdrop-blur-md px-2 py-1.5 pr-12 overflow-x-auto flex items-center gap-1 shrink-0 ui-scroll max-w-full z-10 shadow-xs">
            <TabsList className="flex h-auto w-auto items-center justify-start rounded-none bg-transparent p-0 gap-1 text-muted-foreground">
              {tabItems.map((item) => {
                const ItemIcon = item.icon;
                const isActive = activeTab === item.value;
                return (
                  <TabsTrigger
                    key={item.id}
                    value={item.value}
                    title={item.title ?? item.label}
                    aria-label={item.label}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs whitespace-nowrap font-medium transition-all shrink-0 cursor-pointer select-none border border-transparent",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-xs font-semibold border-primary/20"
                        : "bg-background/60 text-muted-foreground hover:text-foreground hover:bg-accent/40 border-border/60",
                    )}
                  >
                    <ItemIcon className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {item.shortLabel ?? compactTabLabel(item.label)}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
        ) : (
          /* Desktop Vertical Activity Rail */
          <div
            className="border-r border-[var(--rule-color)] shrink-0 w-12 sm:w-14 overflow-hidden"
            style={{
              background:
                "color-mix(in oklab, var(--surface-rail) 75%, var(--surface-page))",
            }}
          >
            <TabsList className="flex h-full w-full flex-col items-center justify-start rounded-none bg-transparent p-0 text-muted-foreground">
              {tabItems.map((item, idx) => {
                const ItemIcon = item.icon;
                const afterFrameworkTabs = idx === 2;
                const isActive = activeTab === item.value;
                return (
                  <div
                    key={item.id}
                    className="w-full flex flex-col items-center"
                  >
                    {afterFrameworkTabs && (
                      <div
                        aria-hidden
                        className="w-6 h-px bg-border/80 my-1.5 shrink-0"
                      />
                    )}
                    <TabsTrigger
                      value={item.value}
                      className={cn(
                        "group relative min-h-12 w-full rounded-none border-0 px-0 py-1.5 text-muted-foreground shadow-none touch-manipulation transition-all duration-200",
                        "hover:text-foreground hover:bg-accent/30",
                        "data-[state=active]:bg-primary/[0.08] data-[state=active]:text-foreground data-[state=active]:shadow-none",
                      )}
                      title={item.title ?? item.label}
                      aria-label={item.label}
                    >
                      {/* Active Left Indicator */}
                      <span
                        aria-hidden
                        className={cn(
                          "absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r transition-all duration-200",
                          isActive
                            ? "bg-[var(--accent-primary)] shadow-[0_0_8px_var(--accent-primary)]"
                            : "bg-transparent group-hover:bg-muted-foreground/30",
                        )}
                      />
                      <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 overflow-hidden px-1">
                        <ItemIcon className="w-4 h-4 shrink-0 transition-transform duration-200 group-hover:scale-110" />
                        <span className="block w-full max-w-full truncate text-center text-[9px] font-medium leading-none whitespace-nowrap">
                          {item.shortLabel ?? compactTabLabel(item.label)}
                        </span>
                      </span>
                    </TabsTrigger>
                  </div>
                );
              })}
            </TabsList>
          </div>
        )}

        {/* Content Area */}
        <ScrollArea className="flex-1 min-h-0 min-w-0">
          <TabsContent
            value="world"
            className="p-3.5 sm:p-4 m-0 max-w-full animate-in fade-in-0 duration-200"
          >
            <div className="mb-3.5 flex min-w-0 items-center justify-between gap-2 border-b border-[var(--rule-color)] pb-3">
              <div className="flex items-center gap-2 min-w-0">
                <BookOpen className="w-4 h-4 shrink-0 text-primary" />
                <h3 className="ui-title text-sm font-semibold tracking-tight truncate text-foreground">
                  {t("session.worldTab")}
                </h3>
              </div>
            </div>
            <WorldDocumentPanel world={world} />
          </TabsContent>

          <TabsContent
            value="database"
            className="p-3.5 sm:p-4 m-0 max-w-full animate-in fade-in-0 duration-200"
          >
            <div className="mb-3.5 flex min-w-0 items-center justify-between gap-2 border-b border-[var(--rule-color)] pb-3">
              <div className="flex items-center gap-2 min-w-0">
                <Database className="w-4 h-4 shrink-0 text-primary" />
                <h3 className="ui-title text-sm font-semibold tracking-tight truncate text-foreground">
                  {t("session.database")}
                </h3>
              </div>
            </div>
            <DatabasePanel
              sessionId={sessionId}
              refreshKey={statePatches.length}
            />
          </TabsContent>

          {/* Dynamic plugin panel content */}
          {pluginTabGroups.map((group) => {
            const subIdx = activePluginSubTab[group.id] ?? 0;
            const currentSub = group.subPanels[subIdx];
            const providerPlan = planPluginPanelProviders(group, subIdx);
            const GroupIcon = resolvePluginIcon(group.icon);

            return (
              <TabsContent
                key={`plugin-content-${group.id}`}
                value={`plugin-${group.id}`}
                className="p-3.5 sm:p-4 m-0 max-w-full animate-in fade-in-0 duration-200"
              >
                <div className="mb-3 flex min-w-0 items-center justify-between gap-2 border-b border-[var(--rule-color)] pb-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <GroupIcon className="w-4 h-4 shrink-0 text-primary" />
                    <h3 className="ui-title text-sm font-semibold tracking-tight truncate text-foreground">
                      {group.label}
                    </h3>
                  </div>
                </div>

                {/* Provider switcher — only when 2+ plugins share the group */}
                {providerPlan.multiProvider && (
                  <div className="flex items-center gap-2 mb-2.5 ui-meta text-[10px] text-muted-foreground">
                    <span>{t("session.provider", "provider")}</span>
                    <div className="flex items-center border border-[var(--rule-color)] rounded-xl overflow-hidden p-0.5 bg-muted/20 backdrop-blur-xs">
                      {providerPlan.providers.map((p) => {
                        const isActive =
                          p.pluginId === providerPlan.activeProviderId;
                        return (
                          <button
                            key={p.pluginId}
                            type="button"
                            onClick={() => {
                              const firstIdx = p.subs[0]?.idx;
                              if (typeof firstIdx === "number") {
                                setActivePluginSubTab((prev) => ({
                                  ...prev,
                                  [group.id]: firstIdx,
                                }));
                              }
                            }}
                            className={cn(
                              "px-2.5 py-1 text-[10px] font-medium tracking-wider transition-all rounded-lg max-w-[10rem] truncate cursor-pointer",
                              isActive
                                ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                                : "text-muted-foreground hover:text-foreground hover:bg-accent/30",
                            )}
                            title={p.pluginId}
                          >
                            {panelProviderLabel(
                              p.pluginId,
                              group.id,
                              p.subs.map((item) => item.sub),
                              sessionState.sessionPlugins,
                              i18n.language,
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Sub-panel chips (filtered to active provider) */}
                {(providerPlan.activeProviderSubs.length > 1 ||
                  (!providerPlan.multiProvider &&
                    group.subPanels.length > 1)) && (
                  <div className="flex items-center gap-1.5 mb-3 border-b border-[var(--rule-color)] pb-2 flex-wrap">
                    {(providerPlan.multiProvider
                      ? providerPlan.activeProviderSubs
                      : group.subPanels.map((sub, idx) => ({ sub, idx }))
                    ).map(({ sub, idx }) => {
                      const SubIcon = resolvePluginIcon(sub.icon);
                      const isActive = idx === subIdx;
                      return (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() =>
                            setActivePluginSubTab((prev) => ({
                              ...prev,
                              [group.id]: idx,
                            }))
                          }
                          className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer",
                            isActive
                              ? "bg-primary/10 text-primary border border-primary/25 font-semibold"
                              : "text-muted-foreground hover:text-foreground hover:bg-accent/30 border border-transparent",
                          )}
                        >
                          <SubIcon className="w-3.5 h-3.5" />
                          <span className="truncate max-w-[8rem]">
                            {sub.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {currentSub && (
                  <PluginPanel
                    key={currentSub.id}
                    pluginId={currentSub.pluginId}
                    spec={currentSub.spec}
                    stateCache={pluginPanelStateCacheRef.current}
                  />
                )}
              </TabsContent>
            );
          })}
        </ScrollArea>
      </Tabs>
    </div>
  );
}
