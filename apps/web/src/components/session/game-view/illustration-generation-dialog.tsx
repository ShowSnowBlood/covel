import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { FrameworkCapability, FrameworkRuntimeCapability } from "@covel/shared";
import type { SessionPluginInfo } from "@/services/api.js";
import type { RuntimeJobStatus } from "@/stores/session-store.js";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { useTranslation } from "react-i18next";

const ACTIVE_STATES = new Set<RuntimeJobStatus["state"]>([
  "queued",
  "running",
  "progress",
]);

function jobKey(status: RuntimeJobStatus): string {
  return `${status.progressScopeId}|${status.pluginId}|${status.runtimeId}|${status.jobId}`;
}

function dataMarksImage(data: RuntimeJobStatus["data"]): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  return (data as Record<string, unknown>).modality === "image";
}

/** Capability-driven match; framework UI never names a concrete image plugin. */
export function isIllustrationJob(
  status: RuntimeJobStatus,
  plugins: readonly SessionPluginInfo[],
): boolean {
  if (dataMarksImage(status.data)) return true;
  const plugin = plugins.find(
    (candidate) => candidate.isActive && candidate.id === status.pluginId,
  );
  if (!plugin) return false;
  const runtime = plugin.runtimes?.find(
    (candidate) => candidate.id === status.runtimeId,
  );
  return Boolean(
    runtime?.capabilities?.includes(
      FrameworkRuntimeCapability.ImageGenerator,
    ) || runtime?.capabilities?.includes(FrameworkCapability.ImageGeneration),
  );
}

function statusTranslationKey(state: RuntimeJobStatus["state"]): string {
  switch (state) {
    case "queued":
      return "session.jobStatusQueued";
    case "running":
      return "session.jobStatusRunning";
    case "progress":
      return "session.jobStatusProgress";
    case "waiting-input":
      return "session.jobStatusWaiting";
    case "succeeded":
      return "session.jobStatusSucceeded";
    case "failed":
      return "session.jobStatusFailed";
    case "cancelled":
      return "session.jobStatusCancelled";
  }
}

export interface IllustrationGenerationDialogProps {
  readonly jobStatuses: readonly RuntimeJobStatus[];
  readonly sessionPlugins: readonly SessionPluginInfo[];
}

/**
 * Opens once for each new image job. Closing it never cancels the background
 * runtime; later progress for the same job stays dismissed, while the next
 * illustration opens a fresh dialog.
 */
export function IllustrationGenerationDialog({
  jobStatuses,
  sessionPlugins,
}: IllustrationGenerationDialogProps): ReactElement | null {
  const { t } = useTranslation();
  const illustrationJobs = useMemo(
    () =>
      jobStatuses.filter((status) => isIllustrationJob(status, sessionPlugins)),
    [jobStatuses, sessionPlugins],
  );
  const activeJobs = illustrationJobs.filter((status) =>
    ACTIVE_STATES.has(status.state),
  );
  const activeJob = activeJobs.at(-1);
  const activeKey = activeJob ? jobKey(activeJob) : null;
  const dismissedJobRef = useRef<string | null>(null);
  const [trackedKey, setTrackedKey] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!activeKey || dismissedJobRef.current === activeKey) return;
    setTrackedKey(activeKey);
    setOpen(true);
  }, [activeKey]);

  const trackedJob = trackedKey
    ? [...illustrationJobs]
        .reverse()
        .find((status) => jobKey(status) === trackedKey)
    : undefined;

  useEffect(() => {
    if (!open || trackedJob?.state !== "succeeded") return;
    const timer = window.setTimeout(() => setOpen(false), 2_400);
    return () => window.clearTimeout(timer);
  }, [open, trackedJob?.state, trackedKey]);

  if (!trackedJob) return null;

  const active = ACTIVE_STATES.has(trackedJob.state);
  const succeeded = trackedJob.state === "succeeded";
  const failed = trackedJob.state === "failed";
  const percent = succeeded
    ? 100
    : typeof trackedJob.progress === "number" &&
        Number.isFinite(trackedJob.progress)
      ? Math.max(0, Math.min(100, trackedJob.progress))
      : undefined;
  const title = succeeded
    ? t("session.illustrationProgress.completeTitle")
    : failed
      ? t("session.illustrationProgress.failedTitle")
      : trackedJob.state === "cancelled"
        ? t("session.illustrationProgress.cancelledTitle")
        : t("session.illustrationProgress.generatingTitle");
  const description = succeeded
    ? t("session.illustrationProgress.completeDescription")
    : failed
      ? t("session.illustrationProgress.failedDescription")
      : t("session.illustrationProgress.generatingDescription");

  const handleOpenChange = (next: boolean): void => {
    if (!next && active) dismissedJobRef.current = trackedKey;
    setOpen(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md overflow-hidden p-0">
        <div className="flex items-start gap-4 border-b border-border/70 px-5 py-5 pr-12 sm:px-6">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
              failed
                ? "border-destructive/35 bg-destructive/10 text-destructive"
                : succeeded
                  ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-500"
                  : "border-primary/35 bg-primary/10 text-primary"
            }`}
          >
            {failed ? (
              <TriangleAlert className="h-5 w-5" aria-hidden="true" />
            ) : succeeded ? (
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Loader2
                className="h-5 w-5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
          </div>
          <DialogHeader className="min-w-0 flex-1 space-y-2 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>{title}</DialogTitle>
              <Badge
                variant={failed ? "destructive" : "outline"}
                className="text-[10px]"
              >
                {t(statusTranslationKey(trackedJob.state))}
              </Badge>
            </div>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-4 px-5 py-5 sm:px-6" aria-live="polite">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
              <span>{t("session.illustrationProgress.progressLabel")}</span>
              <span className="font-mono tabular-nums">
                {percent === undefined ? "…" : `${Math.round(percent)}%`}
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={t("session.illustrationProgress.progressLabel")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-busy={active}
            >
              <div
                className={`h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none ${
                  percent === undefined ? "w-2/5 animate-pulse" : ""
                }`}
                style={
                  percent === undefined ? undefined : { width: `${percent}%` }
                }
              />
            </div>
          </div>

          {failed && trackedJob.message ? (
            <p className="max-h-24 overflow-auto break-words rounded-lg bg-destructive/10 px-3 py-2 font-mono text-[10px] leading-relaxed text-destructive">
              {trackedJob.message}
            </p>
          ) : null}

          {activeJobs.length > 1 ? (
            <p className="text-[11px] text-muted-foreground">
              {t("session.illustrationProgress.multipleJobs", {
                count: activeJobs.length - 1,
              })}
            </p>
          ) : null}

          {active ? (
            <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
              <ImageIcon
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
                aria-hidden="true"
              />
              <span>{t("session.illustrationProgress.backgroundHint")}</span>
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button
              type="button"
              variant={active ? "outline" : "default"}
              size="sm"
              onClick={() => handleOpenChange(false)}
            >
              {active
                ? t("session.illustrationProgress.closeContinue")
                : t("session.illustrationProgress.close")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
