/**
 * Full-screen visual-novel stage (viewMode: "stage"). Composes the five stage
 * layers over a shared plugin-data feed and owns the small amount of
 * cross-layer state the pieces can't hold themselves: which turn's text is
 * fully read (gates the choice overlay), whether the dialog is in free-text
 * input mode (toggled from the sibling choice overlay), auto-play, and the
 * history / pending-form modals.
 *
 * Absolute-positioned layers stack inside a `relative` bounded container in
 * DOM order Backdrop → Sprites → Hud → Dialog → Choices (z-index banded on
 * the components). Data all arrives through `usePluginNamespace`, so the
 * component stays thin — the real logic lives in `stage-selectors`.
 */
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Button } from "@/components/ui/button.js";
import { useMediaQuery } from "@/hooks/use-media-query.js";
import { requestConfirm } from "@/lib/confirm-channel.js";
import { usePluginNamespace } from "@/stores/plugin-data-store.js";
import { useStreamingText } from "@/stores/streaming-text-store.js";
import { AssetTurnSidebar } from "@/components/asset-render/index.js";
import { useImageGeneration } from "../chat-messages/use-image-generation.js";
import type { StreamMessage, ExecutionStep } from "@/stores/session-store.js";
import type {
  SessionRecord,
  WorldRecord,
  PackageSummary,
  SessionPluginInfo,
} from "@/services/api.js";
import { ChatMessages } from "../chat-messages.js";
import { MessageBlockRenderer } from "../chat-messages/message-blocks.js";
import { StageBackdrop } from "./StageBackdrop.js";
import { StageSprites } from "./StageSprites.js";
import { StageHud } from "./StageHud.js";
import { StageDialog } from "./StageDialog.js";
import { StageChoices } from "./StageChoices.js";
import {
  extractInteractionChoices,
  extractPendingFormMessages,
  fallbackStageSpeakers,
  filterStalePrompts,
  findLatestStoryMessage,
  findLatestStoryTurnId,
  mergeChoices,
  pluginIdForCapability,
  STAGE_CAPABILITIES,
  type PresenceRecord,
  type StageCurrentRecord,
  type StageSpeaker,
} from "./stage-selectors.js";

export interface StageViewProps {
  readonly session: SessionRecord;
  readonly world: WorldRecord | null;
  readonly messages: StreamMessage[];
  readonly executing: boolean;
  readonly executionError: string | null;
  readonly executionSteps: ExecutionStep[];
  readonly packages: PackageSummary[];
  readonly sessionPlugins: SessionPluginInfo[];
  readonly submittedBlockIds: ReadonlySet<string>;
  readonly submittedBlockValues: Readonly<
    Record<string, Record<string, unknown>>
  >;
  readonly onSendMessage: (text: string) => void;
  readonly onSubmitBlock: (blockId: string) => void;
  readonly onSubmitInteraction?: (
    blockId: string,
    turnId: string,
    interactionId: string,
    type: "form" | "choice" | "confirmation",
    values: Record<string, unknown>,
    submitBehavior?: { echoFilledNarrative?: boolean },
  ) => Promise<void>;
  readonly onRetryRuntime?: (
    runtimeId: string | undefined,
    sourceTurnId?: string,
  ) => void;
  readonly onBeginAdventure: () => void;
  readonly onViewModeChange: (mode: "parsed") => void;
  /** Whether studio rails are collapsed for full-screen immersion. */
  readonly immersive: boolean;
  /** Toggle immersive (full-screen) stage mode. */
  readonly onToggleImmersive: () => void;
  readonly messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

export function StageView(props: StageViewProps): ReactElement {
  const {
    session,
    world,
    messages,
    executing,
    executionError,
    sessionPlugins,
    submittedBlockIds,
    submittedBlockValues,
    onSendMessage,
    onSubmitBlock,
    onSubmitInteraction,
    onRetryRuntime,
    onViewModeChange,
    immersive,
    onToggleImmersive,
  } = props;
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const sceneStageId =
    pluginIdForCapability(sessionPlugins, STAGE_CAPABILITIES.scene) ?? "";
  const sceneCastId =
    pluginIdForCapability(sessionPlugins, STAGE_CAPABILITIES.cast) ?? "";
  const scenePromptsId =
    pluginIdForCapability(sessionPlugins, STAGE_CAPABILITIES.prompts) ?? "";
  const actionGuideId =
    pluginIdForCapability(sessionPlugins, STAGE_CAPABILITIES.guide) ?? "";
  const presenceId =
    pluginIdForCapability(sessionPlugins, STAGE_CAPABILITIES.presence) ?? "";
  const characterBlueprintId =
    pluginIdForCapability(sessionPlugins, STAGE_CAPABILITIES.characters) ?? "";

  const sceneCurrent = usePluginNamespace(sceneStageId, "stage")["current"] as
    StageCurrentRecord | undefined;
  const activeCast = usePluginNamespace(sceneCastId, "active-cast")[
    "current"
  ] as { speakers?: readonly StageSpeaker[] } | undefined;
  const promptsNamespace = usePluginNamespace(scenePromptsId, "message");
  const guideNamespace = usePluginNamespace(actionGuideId, "message");
  // Mirror portrait-gallery-panel: the presence namespace is consumed as a
  // characterId-keyed record of `{ sprite, avatar, ... }`.
  const presence = usePluginNamespace(presenceId, "presence") as Readonly<
    Record<string, PresenceRecord | undefined>
  >;
  const characterBlueprints = usePluginNamespace(
    characterBlueprintId,
    "blueprints",
  );
  const fallbackCharacterNamespace = useMemo(() => {
    if (Object.keys(characterBlueprints).length > 0) return characterBlueprints;
    const records: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(presence)) {
      if (!value || typeof value !== "object") continue;
      const record = value as PresenceRecord;
      if (record.displayName || record.characterId) {
        records[key] = {
          name: record.displayName ?? record.characterId,
          characterId: record.characterId ?? key,
        };
      }
    }
    return records;
  }, [characterBlueprints, presence]);

  // ── Latest story text + stream state ──────────────────────────
  // Streaming tokens no longer live in `messages[].content` — the placeholder
  // carries empty content and the live text is held in a fine-grained external
  // store. This view subscribes only to the latest story message.
  const storyMsg = findLatestStoryMessage(messages);
  const latestNarrativeTurnId = findLatestStoryTurnId(messages);
  const liveStoryText = useStreamingText(storyMsg?.id ?? "");
  const storyText = storyMsg
    ? liveStoryText?.trim()
      ? liveStoryText
      : storyMsg.content
    : "";
  // Only worlds that opt into the authored visual-novel stage may synthesize
  // or consume character sprites. Traditional worlds can still use the stage
  // presentation for their backdrop and action guide, but an old/explicit
  // scene-cast payload must not turn portrait cards into foreground scenery.
  const stageArtAllowed = world?.metadata?.defaultViewMode === "stage";
  const fallbackSpeakers = useMemo(
    () =>
      stageArtAllowed
        ? fallbackStageSpeakers(fallbackCharacterNamespace, storyText)
        : [],
    [stageArtAllowed, fallbackCharacterNamespace, storyText],
  );
  const activeSpeakers = stageArtAllowed ? (activeCast?.speakers ?? []) : [];
  const speakers =
    activeSpeakers.length > 0 || (activeCast && storyMsg)
      ? activeSpeakers
      : fallbackSpeakers;

  // Stage mode replaces ChatMessages, so it must own the same capability-driven
  // image-generation entry and approval path instead of losing the parsed-view
  // button when the player switches modes.
  const { isImageGenActive, generatingImage, handleGenerateImage } =
    useImageGeneration({
      sessionPlugins,
      sessionId: session.id,
      confirm: requestConfirm,
      t,
    });
  const imageGenerationAvailable = isImageGenActive;
  const isStreaming =
    executing && (storyMsg?.id.startsWith("stream_") ?? false);

  // ── Cross-layer state ─────────────────────────────────────────
  const [autoPlay, setAutoPlay] = useState(false);
  const [inputMode, setInputMode] = useState(false);
  const [allRead, setAllRead] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dismissedFormIds, setDismissedFormIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // New turn: the dialog re-types (its own typewriter resets on turnId), so
  // reset "fully read" here too. Leaving input mode avoids a stale composer.
  useEffect(() => {
    setAllRead(false);
    setInputMode(false);
  }, [latestNarrativeTurnId]);

  const interactionChoices = useMemo(
    () => extractInteractionChoices(messages, submittedBlockIds),
    [messages, submittedBlockIds],
  );
  const pendingForms = useMemo(
    () => extractPendingFormMessages(messages, submittedBlockIds),
    [messages, submittedBlockIds],
  );
  // Drop quick replies left over from a previous turn. Both the scene-prompts
  // and traditional action-guide providers use the same freshness contract.
  const freshPrompts = useMemo(
    () => filterStalePrompts(promptsNamespace, latestNarrativeTurnId),
    [promptsNamespace, latestNarrativeTurnId],
  );
  const freshGuide = useMemo(
    () => filterStalePrompts(guideNamespace, latestNarrativeTurnId),
    [guideNamespace, latestNarrativeTurnId],
  );
  const mergedChoiceItems = useMemo(
    () => mergeChoices(interactionChoices, freshPrompts, locale, [freshGuide]),
    [interactionChoices, freshPrompts, freshGuide, locale],
  );
  const activeForm = pendingForms.find((m) => !dismissedFormIds.has(m.id));
  // The overlay always carries the free-input entry; only *real* choice items
  // (interaction choices / either quick-reply provider) justify dimming sprites.
  const hasChoiceItems = mergedChoiceItems.items.length > 0;
  // `findLatestStoryMessage` deliberately keeps the previous readable line
  // when a persisted completed turn has empty content. The turn-id selector
  // still sees that newest turn; treat the mismatch as an already-settled
  // empty response so it cannot gate the next action forever.
  const emptyLatestNarrative =
    latestNarrativeTurnId !== undefined &&
    latestNarrativeTurnId !== storyMsg?.turnId;
  const choicesVisible =
    (allRead ||
      !storyMsg ||
      storyText.trim().length === 0 ||
      emptyLatestNarrative) &&
    !executing &&
    !inputMode;

  return (
    <div
      className="relative flex-1 min-h-0 overflow-hidden"
      data-testid="stage-view"
    >
      <StageBackdrop
        sceneCurrent={sceneCurrent}
        world={world}
        sessionId={session.id}
      />
      <StageSprites
        speakers={speakers}
        presence={presence}
        sessionId={session.id}
        dimmed={choicesVisible && hasChoiceItems}
      />
      <StageHud
        sceneCurrent={sceneCurrent}
        locale={locale}
        autoPlay={autoPlay}
        immersive={immersive}
        imageGenerationAvailable={imageGenerationAvailable}
        imageGenerationBusy={generatingImage || executing}
        onGenerateImage={() => void handleGenerateImage()}
        onOpenHistory={() => setHistoryOpen(true)}
        onToggleAutoPlay={() => setAutoPlay((v) => !v)}
        onToggleImmersive={onToggleImmersive}
        onExit={() => onViewModeChange("parsed")}
      />
      <StageDialog
        turnId={latestNarrativeTurnId}
        storyText={storyText}
        streamEnded={!isStreaming}
        speakerName={speakers[0]?.name}
        autoPlay={autoPlay}
        reducedMotion={reducedMotion}
        inputMode={inputMode}
        onInputModeChange={setInputMode}
        onAllRead={() => setAllRead(true)}
        onSendMessage={onSendMessage}
      />
      {latestNarrativeTurnId && (
        <div
          className="pointer-events-auto absolute right-3 top-16 z-30 max-h-[34%] w-[min(18rem,calc(100%-1.5rem))] overflow-y-auto rounded-[var(--radius-card)] md:right-4 md:top-20"
          data-testid="stage-assets"
        >
          <AssetTurnSidebar
            turnId={latestNarrativeTurnId}
            sessionId={session.id}
          />
        </div>
      )}
      <StageChoices
        visible={choicesVisible}
        interactionChoices={interactionChoices}
        promptsNamespace={freshPrompts}
        additionalPromptNamespaces={[freshGuide]}
        locale={locale}
        onSubmitInteraction={onSubmitInteraction}
        onSendMessage={onSendMessage}
        onFreeInput={() => setInputMode(true)}
      />

      {/* Thinking indicator — between choice submit and the first stream delta
          the dialog just holds the previous line with no cue that a turn is
          running (narrator can take tens of seconds). Surface a quiet pill in
          the choice band so the player knows the scene is being generated.
          Hidden once deltas arrive: the typewriter itself is then the feedback. */}
      {executing && !isStreaming && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-[8rem] z-30 flex justify-center px-4 md:bottom-40"
          data-testid="stage-thinking"
        >
          <div className="ui-stage-panel flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            <span>{t("stage.thinkingLabel")}</span>
          </div>
        </div>
      )}

      {/* Execution error — a failed turn otherwise just stops the typewriter
          silently on stage; surface it with a retry affordance. */}
      {executionError && (
        <div
          className="pointer-events-none absolute inset-x-0 top-14 z-50 flex justify-center px-4"
          data-testid="stage-error"
        >
          <div className="ui-stage-panel pointer-events-auto flex max-w-2xl items-start gap-2 rounded-[var(--radius-card)] border border-destructive/60 px-4 py-3 text-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-destructive">
                {t("common.error")}
              </p>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                {executionError}
              </p>
            </div>
            {onRetryRuntime && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onRetryRuntime(undefined)}
              >
                {t("session.retryAll")}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* History drawer — the full parsed chat, needs a bounded flex column
          for its internal ScrollArea (flex-1 min-h-0). Zero out executionSteps
          / executionError so the drawer stays player-facing: the per-turn
          runtime timeline (dev timing chips) and the failed-turn banner belong
          on the stage itself, not in this narrative read-back. */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent
          className="max-w-3xl p-0 gap-0"
          aria-describedby={undefined}
        >
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle>{t("stage.historyTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex h-[80vh] flex-col">
            <ChatMessages
              {...props}
              viewMode="parsed"
              executionSteps={[]}
              executionError={null}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Pending form modal — the inline dialog only takes choices/free text,
          so a form interaction surfaces here. */}
      <Dialog
        open={!!activeForm}
        onOpenChange={(open) => {
          if (!open && activeForm) {
            setDismissedFormIds((prev) => new Set(prev).add(activeForm.id));
          }
        }}
      >
        <DialogContent className="max-w-lg" aria-describedby={undefined}>
          <DialogHeader className="sr-only">
            <DialogTitle>{t("stage.formTitle")}</DialogTitle>
          </DialogHeader>
          {activeForm && (
            <MessageBlockRenderer
              msg={activeForm}
              block={activeForm.block as Record<string, unknown>}
              submitted={submittedBlockIds.has(activeForm.id)}
              submittedValues={submittedBlockValues[activeForm.id]}
              executing={executing}
              onSubmitInteraction={onSubmitInteraction}
              onSendMessage={onSendMessage}
              onSubmitBlock={onSubmitBlock}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
