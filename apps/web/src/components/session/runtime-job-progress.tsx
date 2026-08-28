import { CheckCircle2, Clock3, Loader2, XCircle } from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "@/stores/session-store.js";
import type { RuntimeJobStatus } from "@/stores/session-store.js";
import type { PackageSummary } from "@/services/api.js";
import { ShinyText } from "@/components/reactbits/index.js";
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

function StatusBadge({
  state,
  t,
}: {
  state: RuntimeJobStatus["state"];
  t: (key: string, defaultValue: string) => string;
}): ReactElement {
  switch (state) {
    case "succeeded":
      return (
        <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" />
          {statusLabel(state, t)}
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex shrink-0 items-center rounded-full border border-destructive/25 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-destructive">
          <XCircle className="mr-1 h-3 w-3" aria-hidden="true" />
          {statusLabel(state, t)}
        </span>
      );
    case "cancelled":
    case "waiting-input":
      return (
        <span className="inline-flex shrink-0 items-center rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
          <Clock3 className="mr-1 h-3 w-3" aria-hidden="true" />
          {statusLabel(state, t)}
        </span>
      );
    default:
      return (
        <span className="inline-flex shrink-0 items-center rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
          {statusLabel(state, t)}
        </span>
      );
  }
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
  const executing = Boolean(session.state.executing);
  const jobStatuses = session.state.jobStatuses ?? [];
  const packages = session.state.packages ?? [];

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

  const hasActiveJobs = visible.some((status) => isActive(status.state));

  // If a turn is actively executing but no active job status has arrived yet
  // (e.g. initial turn preparation / SSE handshake latency), render an instant
  // responsive feedback card so player actions feel immediate.
  const showInstantDispatching =
    executing && (!hasActiveJobs || visible.length === 0);

  if (!showInstantDispatching && visible.length === 0) return null;

  return (
    <div
      className={`ui-runtime-job-progress space-y-2 ${className}`}
      data-testid="runtime-job-progress"
      aria-live="polite"
    >
      {showInstantDispatching ? (
        <div
          className="relative overflow-hidden rounded-xl border border-primary/30 bg-card/95 p-3 text-xs shadow-md backdrop-blur-md transition-all duration-300 dark:border-primary/40 dark:bg-card/90"
          data-runtime-job-id="turn-dispatching"
          data-progress-state="running"
        >
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                <span className="absolute -inset-0.5 rounded-full bg-primary/25 animate-pulse" />
                <Loader2
                  className="relative z-10 h-3.5 w-3.5 animate-spin text-primary"
                  aria-hidden="true"
                />
              </div>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                <ShinyText speed={3} className="font-medium">
                  {t("session.turnDispatching", "正在推进回合")}
                </ShinyText>
              </span>
            </div>
            <span className="inline-flex shrink-0 items-center rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Loader2
                className="mr-1 h-3 w-3 animate-spin"
                aria-hidden="true"
              />
              {t("session.jobStatusRunning", "运行中")}
            </span>
          </div>
          <div
            className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted/80 dark:bg-muted/40"
            role="progressbar"
            aria-label={`${t("session.turnDispatching", "正在推进回合")} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full w-full rounded-full bg-gradient-to-r from-primary/30 via-primary to-primary/30 animate-[ui-progress-shimmer_1.5s_infinite]" />
          </div>
          <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2 text-[11px]">
            <span className="min-w-0 flex-1 truncate text-foreground/80 font-normal">
              {t("session.turnDispatchingDesc", "正在调度插件与剧情任务...")}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70 px-1.5 py-0.5 rounded bg-muted/40 border border-border/40">
              turn
            </span>
          </div>
        </div>
      ) : (
        visible.map((status) => {
          const percent =
            typeof status.progress === "number" &&
            Number.isFinite(status.progress)
              ? Math.max(0, Math.min(100, status.progress))
              : undefined;
          return (
            <div
              key={`${status.progressScopeId}|${status.pluginId}|${status.runtimeId}|${status.jobId}`}
              className="relative overflow-hidden rounded-xl border border-border/70 bg-card/95 p-3 text-xs shadow-md backdrop-blur-md transition-all duration-300 dark:border-border/40 dark:bg-card/90"
              data-runtime-job-id={status.jobId}
              data-progress-state={status.state}
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {jobLabel(status, i18n.language, packages)}
                  </span>
                </div>
                <StatusBadge state={status.state} t={t} />
              </div>
              <div
                className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted/80 dark:bg-muted/40"
                role="progressbar"
                aria-label={`${jobLabel(status, i18n.language, packages)} progress`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                {percent !== undefined ? (
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-primary/80 transition-[width] duration-300 ease-out"
                    style={{ width: `${percent}%` }}
                  />
                ) : isActive(status.state) ? (
                  <div className="h-full w-full rounded-full bg-gradient-to-r from-primary/30 via-primary to-primary/30 animate-[ui-progress-shimmer_1.5s_infinite]" />
                ) : null}
              </div>
              {(status.message || status.jobId) && (
                <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2 text-[11px]">
                  {status.message && (
                    <span className="min-w-0 flex-1 truncate text-foreground/80 font-normal">
                      {status.message}
                    </span>
                  )}
                  {status.jobId && (
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70 px-1.5 py-0.5 rounded bg-muted/40 border border-border/40">
                      {status.jobId}
                    </span>
                  )}
                </div>
              )}
              {isActive(status.state) && percent === undefined && (
                <div className="sr-only">
                  {t("session.jobStatusActive", "Active")}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
