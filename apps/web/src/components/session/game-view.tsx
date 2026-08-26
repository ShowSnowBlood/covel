import { frostFoxLevelForWorld } from "@covel/shared";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { usePanelCollapse } from "./game-view/use-panel-collapse.js";
import { useNavTabActivation } from "./game-view/use-nav-tab-activation.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { SuspensionsPanel } from "./suspensions-panel.js";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable.js";
import { useDefaultLayout } from "react-resizable-panels";
import { useMediaQuery } from "@/hooks/use-media-query.js";
import { useSlotConfig } from "@/hooks/use-slot-config.js";
import { SettingsDialog } from "@/settings/SettingsDialog.js";
import { ChatMessages } from "./chat-messages.js";
import { StageView } from "./stage/StageView.js";
import {
  findLatestStoryMessage,
  hasSubmittedForm,
} from "./stage/stage-selectors.js";
import { useStageMediaPreload } from "./stage/use-stage-media-preload.js";
import { useSession } from "@/stores/session-store.js";
import {
  completeFrostFoxLevel,
  fetchFrostFoxProgression,
  FROSTFOX_RECENT_UNLOCK_STORAGE_KEY,
  updateSession,
  type FrostFoxProgressionStatus,
  type SessionRecord,
} from "@/services/api.js";

import { useSettingsDialog } from "@/hooks/use-settings-dialog.js";
import { useDocumentSessionState } from "@/hooks/use-document-session-state.js";
import { LeftPanel } from "./left-panel.js";
import { RightPanel } from "./right-panel.js";
import {
  GameViewHeader,
  type GameViewMode,
} from "./game-view/game-view-header.js";
import { MessageComposer } from "./game-view/message-composer.js";
import { PendingDraftsBar } from "./game-view/pending-drafts-bar.js";
import { useGameViewComposer } from "./game-view/use-game-view-composer.js";
import { worldVisual } from "@/lib/world-visuals.js";
import { ignoreError } from "@/lib/ignore-error.js";
import { SceneLoadingTransition } from "@/components/visual-effects/SceneLoadingTransition.js";
import { text } from "@/components/world/editor-helpers.js";

// ── Extracted Panel Components (see left-panel.tsx, right-panel.tsx) ──

// ── Main Component ──────────────────────────────────────────────

interface GameViewProps {
  /**
   * The active session, passed by the route (whose `state.session` null-check
   * is the narrowing). Everything else is read from the session store.
   */
  session: SessionRecord;
}

export function GameView({ session }: GameViewProps) {
  const {
    state,
    sendMessage: onSendMessage,
    submitBlock: onSubmitBlock,
    submitInteraction: onSubmitInteraction,
    beginAdventure: onBeginAdventure,
    retryRuntime: onRetryRuntime,
    resetSession: onResetSession,
    backToWorldSelect: onBackToWorldSelect,
    resumeSession: onSwitchSession,
    deleteSession: onDeleteSession,
    loadWorldSessions: onLoadWorldSessions,
    loadSessionPlugins: onLoadSessionPlugins,
    toggleSessionPlugin: onTogglePlugin,
  } = useSession();
  const {
    world,
    messages,
    executing,
    executionError,
    packages,
    pluginLoadErrors,
    sessionPlugins,
    presets,
    llmConfig,
    statePatches,
    executionSteps,
    worldSessions,
    submittedBlockIds,
    submittedBlockValues,
  } = state;
  const { t } = useTranslation();
  const campaignLevel = world ? frostFoxLevelForWorld(world.id) : null;
  const [levelProgression, setLevelProgression] =
    useState<FrostFoxProgressionStatus | null>(null);
  const [completingLevel, setCompletingLevel] = useState(false);
  const [viewTransition, setViewTransition] = useState<{
    image?: string;
    title?: string;
    subtitle?: string;
    steps?: string[];
    onComplete: () => void;
  } | null>(null);

  const handleGoWorldSelect = useCallback(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onBackToWorldSelect();
      return;
    }
    const visual = world ? worldVisual(world) : null;
    setViewTransition({
      image: visual?.image ?? "/visuals/backgrounds/home-hero.webp",
      title: t("session.breadcrumbWorldSelect", "选择世界"),
      subtitle: t("transition.returningWorldSelect"),
      steps: [
        t("transition.saveSession"),
        t("transition.loadArchives"),
        t("transition.readyWorldSelect"),
      ],
      onComplete: () => {
        setViewTransition(null);
        onBackToWorldSelect();
      },
    });
  }, [world, t, onBackToWorldSelect]);

  const handleGoPrep = useCallback(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onResetSession();
      return;
    }
    const visual = world ? worldVisual(world) : null;
    setViewTransition({
      image: visual?.image ?? "/visuals/backgrounds/home-hero.webp",
      title: text(world?.name),
      subtitle: t("transition.enteringWorldPrep"),
      steps: [
        t("transition.pauseSession"),
        t("transition.loadWorldConfig"),
        t("transition.readyPrep"),
      ],
      onComplete: () => {
        setViewTransition(null);
        onResetSession();
      },
    });
  }, [world, t, onResetSession]);
  useEffect(() => {
    let cancelled = false;
    if (campaignLevel === null) {
      setLevelProgression(null);
      return;
    }
    fetchFrostFoxProgression(true)
      .then((next) => {
        if (!cancelled) setLevelProgression(next);
      })
      .catch(() => {
        if (!cancelled) setLevelProgression(null);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignLevel]);

  const levelCompleted =
    campaignLevel !== null &&
    levelProgression !== null &&
    campaignLevel <= levelProgression.completedLevel;
  const canCompleteLevel =
    campaignLevel !== null &&
    levelProgression !== null &&
    campaignLevel === levelProgression.unlockedLevel &&
    session.turnCount > 0 &&
    !executing;

  async function handleCompleteLevel() {
    if (campaignLevel === null || !canCompleteLevel || completingLevel) return;
    setCompletingLevel(true);
    try {
      const next = await completeFrostFoxLevel(world!.id);
      setLevelProgression(next);
      if (next.completedLevel < next.totalLevels) {
        sessionStorage.setItem(
          FROSTFOX_RECENT_UNLOCK_STORAGE_KEY,
          String(next.unlockedLevel),
        );
      }

      try {
        await updateSession(session.id, { status: "ended" });
      } catch {
        // Progression is authoritative; request() already reports the
        // secondary session-status failure to the player.
      }
      handleGoWorldSelect();
    } catch {
      // request() already surfaced the completion failure.
    } finally {
      setCompletingLevel(false);
    }
  }

  const { resolvedSlots, refresh: refreshSlots } = useSlotConfig(
    presets,
    llmConfig,
  );

  const [viewMode, setViewMode] = useState<GameViewMode>(() =>
    world?.metadata?.defaultViewMode === "stage" ? "stage" : "parsed",
  );
  // Full-screen stage: collapse both studio rails + hide the session header so
  // the stage fills the viewport. Session-memory only (no persistence).
  const [immersive, setImmersive] = useState(false);
  // Warm the media cache with known stage art (sprites + scene backdrops)
  // during pre-game, so the opening turn paints them without a download stall.
  useStageMediaPreload(session.id, sessionPlugins);
  // Enter stage after the first playable output as well as after the opening
  // form. Legacy sessions can have story messages while their mirrored
  // turnCount is still zero; gating only on the counter silently leaves the
  // player in parsed view when they switch modes.
  const hasStoryOutput = findLatestStoryMessage(messages) !== undefined;
  const stageReady =
    session.turnCount >= 1 ||
    hasSubmittedForm(messages, submittedBlockIds) ||
    hasStoryOutput;
  const settings = useSettingsDialog(refreshSlots);
  // Publishes data-turn / data-session on <html> for theme CSS to hook into.
  useDocumentSessionState();

  const {
    inputValue,
    setInputValue,
    pendingDrafts,
    suspensions,
    composerBlocked,
    composerDisabled,
    awaitingBegin,
    handleConfirmDrafts,
    handleSubmit,
    handleAbort,
    handleKeyDown,
    removeInteractionDraft,
    resumeSuspension,
    cancelSuspension,
  } = useGameViewComposer({
    messages,
    submittedBlockIds,
    executing,
    session,
    onSendMessage,
  });
  const [suspensionsOpen, setSuspensionsOpen] = useState(false);

  // Load session-scoped plugin list whenever the session changes.
  useEffect(() => {
    onLoadSessionPlugins().catch(
      ignoreError("load session plugins on session change"),
    );
  }, [session.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isMobile = useMediaQuery("(max-width: 768px)");
  const isTablet = useMediaQuery("(max-width: 1024px)");

  const {
    leftPanelRef,
    rightPanelRef,
    isLeftCollapsed,
    isRightCollapsed,
    handleLeftResize,
    handleRightResize,
    toggleLeftPanel,
    toggleRightPanel,
  } = usePanelCollapse(isMobile, isTablet);

  // Immersive stage: collapse both rails on enter, restore prior expansion on
  // exit. On mobile/tablet the rails are already collapsed by usePanelCollapse,
  // so we only drive the imperative panels on wide viewports.
  const priorRailState = useRef<{ left: boolean; right: boolean } | null>(null);
  useEffect(() => {
    if (isMobile || isTablet) return;
    const left = leftPanelRef.current;
    const right = rightPanelRef.current;
    if (!left || !right) return;
    if (immersive) {
      priorRailState.current = {
        left: left.isCollapsed(),
        right: right.isCollapsed(),
      };
      left.collapse();
      right.collapse();
    } else if (priorRailState.current) {
      if (!priorRailState.current.left) left.expand();
      if (!priorRailState.current.right) right.expand();
      priorRailState.current = null;
    }
  }, [immersive, isMobile, isTablet, leftPanelRef, rightPanelRef]);

  // Esc leaves immersive — but only when nothing editable is focused (the stage
  // free-text composer owns Esc to cancel input) and no modal already ate it.
  useEffect(() => {
    if (!immersive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.isContentEditable ||
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA")
      )
        return;
      setImmersive(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [immersive]);

  // Leaving stage always drops immersion so a hidden header can't strand the
  // player in a chrome-less non-stage view.
  const handleViewModeChange = (mode: GameViewMode) => {
    if (mode !== "stage") setImmersive(false);
    setViewMode(mode);
  };
  // A session created before the visual-stage pack was selected can still be
  // switched into stage mode. Re-enable the providers the mode needs by
  // capability, not by assuming a particular plugin implementation. Image
  // generation is enabled only for one available provider, preferring a
  // world-recommended plugin so two image runtimes never compete for the HUD.
  const stageAutoEnableRequested = useRef<Set<string>>(new Set());
  useEffect(() => {
    stageAutoEnableRequested.current.clear();
  }, [session.id]);
  useEffect(() => {
    if (viewMode !== "stage") return;

    const visualCapabilities = new Set([
      "scene-stage",
      "scene-cast",
      "scene-prompts",
      "character-presence",
      "character-blueprint",
    ]);
    const metadata = world?.metadata;
    const policy =
      metadata?.pluginPolicy &&
      typeof metadata.pluginPolicy === "object" &&
      !Array.isArray(metadata.pluginPolicy)
        ? (metadata.pluginPolicy as Record<string, unknown>)
        : undefined;
    const excludedPlugins = new Set<string>(
      [
        ...(Array.isArray(metadata?.excludedPlugins)
          ? metadata.excludedPlugins
          : []),
        ...(Array.isArray(policy?.excludedPlugins)
          ? policy.excludedPlugins
          : []),
      ].filter((pluginId): pluginId is string => typeof pluginId === "string"),
    );
    const canAutoEnable = (plugin: (typeof sessionPlugins)[number]) =>
      plugin.source !== "community" && !excludedPlugins.has(plugin.id);
    const targets = new Set<string>();
    for (const plugin of sessionPlugins) {
      if (
        plugin.isActive ||
        !canAutoEnable(plugin) ||
        !plugin.capabilities
      ) continue;
      if (
        plugin.capabilities.some((capability) =>
          visualCapabilities.has(capability),
        )
      ) {
        targets.add(plugin.id);
      }
    }

    const hasActiveImageProvider = sessionPlugins.some(
      (plugin) =>
        plugin.isActive &&
        plugin.capabilities?.includes("image-generation") &&
        plugin.runtimes?.some(
          (runtime) =>
            runtime.trigger?.type === "manual" &&
            runtime.capabilities?.includes("image-prompt"),
        ),
    );
    if (!hasActiveImageProvider) {
      const recommended = new Set<string>(
        [
          ...(Array.isArray(metadata?.recommendedPlugins)
            ? metadata.recommendedPlugins
            : []),
          ...(Array.isArray(policy?.recommendedPlugins)
            ? policy.recommendedPlugins
            : []),
        ].filter(
          (pluginId): pluginId is string => typeof pluginId === "string",
        ),
      );
      const imageProvider = sessionPlugins
        .filter(
          (plugin) =>
            !plugin.isActive &&
            canAutoEnable(plugin) &&
            plugin.capabilities?.includes("image-generation") &&
            plugin.runtimes?.some(
              (runtime) =>
                runtime.trigger?.type === "manual" &&
                runtime.capabilities?.includes("image-prompt"),
            ),
        )
        .sort(
          (a, b) =>
            Number(recommended.has(b.id)) - Number(recommended.has(a.id)) ||
            a.id.localeCompare(b.id),
        )[0];
      if (imageProvider) targets.add(imageProvider.id);
    }

    for (const pluginId of targets) {
      if (stageAutoEnableRequested.current.has(pluginId)) continue;
      stageAutoEnableRequested.current.add(pluginId);
      void onTogglePlugin(pluginId, true);
    }
  }, [onTogglePlugin, sessionPlugins, viewMode, world]);

  // Sentinel ref for the bottom of the message list. Auto-scroll behaviour
  // (sticky-bottom + jump-to-latest) lives in ChatMessages via useAutoScroll;
  // this ref is shared so external callers can still reach the list tail.
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Topbar nav → in-page panel actions. The global topbar dispatches via
  // nav-events because it can't reach this component's local state directly.
  useNavTabActivation({
    rightPanelRef,
    onOpenPlugins: () => settings.openWithKey("plugin"),
  });

  const direction = isMobile ? "vertical" : "horizontal";
  const visual = worldVisual(world);

  // Remember how the player left the rails — collapsed, or dragged to a
  // particular width. Mobile and desktop keep separate layouts: the mobile
  // group stacks vertically and renders the right rail in a different slot,
  // so one layout cannot describe both. Until a layout is stored, each
  // panel's own `defaultSize` applies.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: isMobile ? "covel:game-layout:mobile" : "covel:game-layout:desktop",
    storage: localStorage,
  });

  // ── Left Panel ─────────────────────────────────────────────────

  const enabledPackages = packages.filter((p) => p.enabled);
  const [showSessionList, setShowSessionList] = useState(false);
  const otherSessions = worldSessions.filter((s) => s.id !== session.id);

  const handleToggleSessionList = () => {
    if (!showSessionList) onLoadWorldSessions();
    setShowSessionList((v) => !v);
  };

  // ── Layout ─────────────────────────────────────────────────────

  return (
    <div className="flex h-full w-full overflow-hidden border-t border-border">
      <SettingsDialog
        open={settings.open}
        onOpenChange={settings.onOpenChange}
        initialKey={settings.initialKey}
      />

      <Dialog open={suspensionsOpen} onOpenChange={setSuspensionsOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("session.suspensionsTitle")}</DialogTitle>
            <DialogDescription>
              {t("session.suspensionsDescription")}
            </DialogDescription>
          </DialogHeader>
          <SuspensionsPanel
            suspensions={suspensions}
            onResume={resumeSuspension}
            onCancel={cancelSuspension}
          />
        </DialogContent>
      </Dialog>

      <ResizablePanelGroup
        id="game-layout"
        orientation={direction}
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        className="w-full h-full"
      >
        {/* Left Panel */}
        {/* Collapsed by default on every viewport: the rail holds studio
            configuration (plugin toggles, model slots), not anything the
            player acts on mid-story. The header toggle brings it back. */}
        <ResizablePanel
          id="left-panel"
          panelRef={leftPanelRef}
          defaultSize="0%"
          minSize="15%"
          maxSize={isMobile ? "80%" : "40%"}
          collapsible={true}
          collapsedSize="0%"
          onResize={handleLeftResize}
          className="ui-rail flex flex-col min-h-0 min-w-0"
        >
          <LeftPanel
            session={session}
            isLeftCollapsed={isLeftCollapsed}
            showSessionList={showSessionList}
            otherSessions={otherSessions}
            enabledPackages={enabledPackages}
            pluginLoadErrors={pluginLoadErrors}
            sessionPlugins={sessionPlugins}
            executing={executing}
            resolvedSlots={resolvedSlots}
            onToggleLeftPanel={toggleLeftPanel}
            onToggleSessionList={handleToggleSessionList}
            onSwitchSession={onSwitchSession}
            onDeleteSession={onDeleteSession}
            onCloseSessionList={() => setShowSessionList(false)}
            onOpenSettings={() => settings.setOpen(true)}
            onResetSession={onResetSession}
            onTogglePlugin={onTogglePlugin}
          />
        </ResizablePanel>

        <ResizableHandle
          withHandle
          orientation={direction}
          className={isLeftCollapsed ? "hidden" : ""}
        />

        {/* Mobile: Right panel before center */}
        {isMobile && (
          <>
            <ResizablePanel
              id="right-panel-mobile"
              panelRef={rightPanelRef}
              defaultSize="0%"
              minSize="20%"
              maxSize="80%"
              collapsible={true}
              collapsedSize="0%"
              onResize={handleRightResize}
              className="ui-rail flex flex-col min-h-0 min-w-0"
            >
              <RightPanel
                sessionId={session.id}
                world={world}
                statePatches={statePatches}
              />
            </ResizablePanel>
            <ResizableHandle
              withHandle
              orientation={direction}
              className={isRightCollapsed ? "hidden" : ""}
            />
          </>
        )}

        {/* Center Panel */}
        <ResizablePanel
          id="center-panel"
          defaultSize={isMobile ? "100%" : "55%"}
          minSize={isMobile ? "20%" : "30%"}
          className="relative flex flex-col min-w-0 min-h-0 overflow-hidden"
          style={
            {
              "--world-accent": visual.accent,
              background: "var(--surface-page)",
            } as React.CSSProperties
          }
        >
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <img
              src={visual.image}
              alt=""
              aria-hidden="true"
              width={1536}
              height={1024}
              loading="lazy"
              className="absolute inset-x-0 top-0 h-56 w-full object-cover opacity-[0.08] saturate-75"
              draggable={false}
            />
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-72"
              style={{
                background:
                  "linear-gradient(180deg, color-mix(in oklab, var(--world-accent) 12%, transparent) 0%, var(--surface-page) 92%)",
              }}
            />
          </div>
          {/* Header — hidden while the stage is immersive so it fills the
              viewport. Fades back in on exit (rails snap; chrome fades). */}
          {!(immersive && viewMode === "stage") && (
            <div className="animate-in fade-in-0 duration-200">
              <GameViewHeader
                t={t}
                world={world}
                executing={executing}
                viewMode={viewMode}
                isLeftCollapsed={isLeftCollapsed}
                isRightCollapsed={isRightCollapsed}
                onViewModeChange={handleViewModeChange}
                onToggleLeftPanel={toggleLeftPanel}
                onToggleRightPanel={toggleRightPanel}
                onOpenSettings={() => settings.setOpen(true)}
                onOpenSuspensions={() => setSuspensionsOpen(true)}
                onBackToWorldSelect={handleGoWorldSelect}
                onResetSession={handleGoPrep}
                suspensionsCount={suspensions.length}
                campaignLevel={campaignLevel ?? undefined}
                canCompleteLevel={canCompleteLevel}
                levelCompleted={levelCompleted}
                completingLevel={completingLevel}
                onCompleteLevel={handleCompleteLevel}
              />
            </div>
          )}

          {/* Messages */}
          {viewMode === "stage" && stageReady ? (
            <StageView
              session={session}
              world={world}
              messages={messages}
              executing={executing}
              executionError={executionError}
              executionSteps={executionSteps}
              packages={packages}
              sessionPlugins={sessionPlugins}
              submittedBlockIds={submittedBlockIds}
              submittedBlockValues={submittedBlockValues}
              onSendMessage={onSendMessage}
              onSubmitBlock={onSubmitBlock}
              onSubmitInteraction={onSubmitInteraction}
              onRetryRuntime={onRetryRuntime}
              onBeginAdventure={onBeginAdventure}
              onViewModeChange={handleViewModeChange}
              immersive={immersive}
              onToggleImmersive={() => setImmersive((v) => !v)}
              messagesEndRef={messagesEndRef}
            />
          ) : (
            <>
              <ChatMessages
                messages={messages}
                executionSteps={executionSteps}
                executionError={executionError}
                executing={executing}
                session={session}
                world={world}
                packages={packages}
                sessionPlugins={sessionPlugins}
                submittedBlockIds={submittedBlockIds}
                submittedBlockValues={submittedBlockValues}
                viewMode={viewMode}
                onSendMessage={onSendMessage}
                onSubmitBlock={onSubmitBlock}
                onSubmitInteraction={onSubmitInteraction}
                onRetryRuntime={onRetryRuntime}
                onBeginAdventure={onBeginAdventure}
                messagesEndRef={messagesEndRef}
              />

              <PendingDraftsBar
                t={t}
                pendingDrafts={pendingDrafts}
                executing={executing}
                onConfirmDrafts={handleConfirmDrafts}
                onRemoveDraft={removeInteractionDraft}
              />

              {/* Input — always fixed at bottom */}
              <MessageComposer
                t={t}
                session={session}
                executing={executing}
                inputValue={inputValue}
                composerBlocked={composerBlocked}
                composerDisabled={composerDisabled}
                awaitingBegin={awaitingBegin}
                onInputValueChange={setInputValue}
                onSubmit={handleSubmit}
                onAbort={handleAbort}
                onKeyDown={handleKeyDown}
              />
            </>
          )}
        </ResizablePanel>

        {/* Desktop: Right panel */}
        {!isMobile && (
          <>
            <ResizableHandle
              withHandle
              orientation={direction}
              className={isRightCollapsed ? "hidden" : ""}
            />
            <ResizablePanel
              id="right-panel"
              panelRef={rightPanelRef}
              defaultSize="25%"
              minSize="20%"
              maxSize="50%"
              collapsible={true}
              collapsedSize="0%"
              onResize={handleRightResize}
              className="ui-rail flex flex-col min-h-0 min-w-0"
            >
              <RightPanel
                sessionId={session.id}
                world={world}
                statePatches={statePatches}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      {viewTransition && (
        <SceneLoadingTransition
          image={viewTransition.image}
          title={viewTransition.title}
          subtitle={viewTransition.subtitle}
          steps={viewTransition.steps}
          onComplete={viewTransition.onComplete}
        />
      )}
    </div>
  );
}
