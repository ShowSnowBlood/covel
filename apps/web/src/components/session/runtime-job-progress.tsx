import { CheckCircle2, Clock3, Loader2, XCircle } from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "@/stores/session-store.js";
import type { RuntimeJobStatus } from "@/stores/session-store.js";
import type { PackageSummary } from "@/services/api.js";

interface RuntimeJobProgressProps {
  readonly className?: string;
}

function displayName(
  value: string | Record<string, string> | undefined,
  locale: string,
): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  return value[locale] ?? value["en-US"] ?? Object.values(value)[0];
}
function jobLabel(
  status: RuntimeJobStatus,
  locale: string,
  packages: readonly PackageSummary[],
): string {
  const pkg = packages.find((entry) => entry.name === status.pluginId);
  const label = displayName(pkg?.displayName, locale);
  if (status.runtimeId === status.pluginId) return label ?? status.runtimeId;
  const suffix = status.runtimeId.startsWith(`${status.pluginId}/`)
    ? status.runtimeId.slice(status.pluginId.length + 1)
    : status.runtimeId;
  return `${label ?? status.pluginId} / ${suffix}`;
}

function StatusIcon({
  state,
}: {
  state: RuntimeJobStatus["state"];
}): ReactElement {
  if (state === "succeeded") {
    return (
      <CheckCircle2
        className="h-3.5 w-3.5 text-emerald-500"
        aria-hidden="true"
      />
    );
  }
  if (state === "failed") {
    return (
      <XCircle className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
    );
  }
  if (state === "cancelled" || state === "waiting-input") {
    return <Clock3 className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />;
  }
  return (
    <Loader2
      className="h-3.5 w-3.5 animate-spin text-primary"
      aria-hidden="true"
    />
  );
}

function statusLabel(
  state: RuntimeJobStatus["state"],
  t: (key: string, defaultValue: string) => string,
): string {
  switch (state) {
    case "queued":
      return t("session.jobStatusQueued", "Queued");
    case "running":
      return t("session.jobStatusRunning", "Running");
    case "progress":
      return t("session.jobStatusProgress", "In progress");
    case "waiting-input":
      return t("session.jobStatusWaiting", "Waiting for input");
    case "succeeded":
      return t("session.jobStatusSucceeded", "Complete");
    case "failed":
      return t("session.jobStatusFailed", "Failed");
    case "cancelled":
      return t("session.jobStatusCancelled", "Cancelled");
  }
}

function isActive(state: RuntimeJobStatus["state"]): boolean {
  return state === "queued" || state === "running" || state === "progress";
}

/**
 * Compact player-facing projection of the kernel job-status stream. It is
 * intentionally separate from the persisted execution-step timeline: job
 * updates can be frequent and must never turn the execution-step cache into a
 * high-frequency write path.
 */
export function RuntimeJobProgress({
  className = "",
}: RuntimeJobProgressProps): ReactElement | null {
  const { i18n, t } = useTranslation();
  const session = useSession();
  const jobStatuses = session.state.jobStatuses ?? [];
  const packages = session.state.packages ?? [];
  if (jobStatuses.length === 0) return null;

  // Keep the current turn (plus uncorrelated background jobs) visible while
  // older turns remain available in the store for dedupe and diagnostics.
  const latestTurnId = [...jobStatuses]
    .reverse()
    .find((status) => status.turnId)?.turnId;
  const visible = jobStatuses
    .filter(
      (status) =>
        !latestTurnId || !status.turnId || status.turnId === latestTurnId,
    )
    .slice(-8);
  if (visible.length === 0) return null;

  return (
    <div
      className={`ui-runtime-job-progress space-y-1.5 ${className}`}
      data-testid="runtime-job-progress"
      aria-live="polite"
    >
      {visible.map((status) => {
        const percent =
          typeof status.progress === "number" &&
          Number.isFinite(status.progress)
            ? Math.max(0, Math.min(100, status.progress))
            : undefined;
        return (
          <div
            key={`${status.progressScopeId}|${status.pluginId}|${status.runtimeId}|${status.jobId}`}
            className="rounded-md border border-border/60 bg-background/80 px-3 py-2 text-xs shadow-sm"
            data-runtime-job-id={status.jobId}
            data-progress-state={status.state}
          >
            <div className="flex min-w-0 items-center gap-2">
              <StatusIcon state={status.state} />
              <span className="min-w-0 flex-1 truncate font-medium">
                {jobLabel(status, i18n.language, packages)}
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                {statusLabel(status.state, t)}
              </span>
            </div>
            {percent !== undefined && (
              <div
                className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label={`${jobLabel(status, i18n.language, packages)} progress`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200"
                  style={{ width: `${percent}%` }}
                />
              </div>
            )}
            {(status.message || status.jobId) && (
              <div className="mt-1 flex min-w-0 items-baseline gap-2 text-[11px] text-muted-foreground">
                {status.message && (
                  <span className="min-w-0 flex-1 truncate">
                    {status.message}
                  </span>
                )}
                <span className="shrink-0 font-mono text-[10px] opacity-60">
                  {status.jobId}
                </span>
              </div>
            )}
            {isActive(status.state) && percent === undefined && (
              <div className="sr-only">
                {t("session.jobStatusActive", "Active")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
