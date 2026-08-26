import { useCallback, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  History,
  KeyRound,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Badge } from "@/components/ui/badge.js";
import { ScrollArea } from "@/components/ui/scroll-area.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import type {
  PackageSummary,
  PluginLoadError,
  SessionPluginInfo,
  SessionRecord,
} from "@/services/api.js";
import type { ResolvedSlot } from "@/hooks/use-slot-config.js";
import { ActiveModelSlots } from "./active-model-slots.js";
import { PluginListPanel } from "./plugin-list-panel.js";

export interface LeftPanelProps {
  session: SessionRecord;
  isLeftCollapsed: boolean;
  showSessionList: boolean;
  otherSessions: SessionRecord[];
  enabledPackages: PackageSummary[];
  pluginLoadErrors: PluginLoadError[];
  sessionPlugins: SessionPluginInfo[];
  executing: boolean;
  resolvedSlots: ResolvedSlot[];
  onToggleLeftPanel: () => void;
  onToggleSessionList: () => void;
  onSwitchSession: (session: SessionRecord) => void;
  onDeleteSession: (sessionId: string) => Promise<void>;
  onCloseSessionList: () => void;
  onOpenSettings: () => void;
  onResetSession: () => void;
  onTogglePlugin: (pluginId: string, enabled: boolean) => void;
}

export function LeftPanel({
  session,
  isLeftCollapsed: _isLeftCollapsed,
  showSessionList,
  otherSessions,
  enabledPackages,
  pluginLoadErrors,
  sessionPlugins,
  executing,
  resolvedSlots,
  onToggleLeftPanel: _onToggleLeftPanel,
  onToggleSessionList,
  onSwitchSession,
  onDeleteSession,
  onCloseSessionList,
  onOpenSettings,
  onResetSession,
  onTogglePlugin,
}: LeftPanelProps): ReactElement {
  const { t } = useTranslation();
  const [deleteTarget, setDeleteTarget] = useState<SessionRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await onDeleteSession(deleteTarget.id);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, onDeleteSession]);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-background text-foreground">
      <div className="ui-panel-header px-3.5 py-2.5 flex items-center justify-between gap-2 border-b border-border/80 bg-card/40 backdrop-blur-xs">
        <div className="flex items-center gap-2 min-w-0">
          <SlidersHorizontal className="w-3.5 h-3.5 text-primary shrink-0" />
          <h2 className="ui-title text-xs sm:text-sm font-semibold whitespace-nowrap truncate text-foreground">
            {t("session.config", "Studio Config")}
          </h2>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-muted/40 px-2 py-0.5 text-[9px] font-mono text-muted-foreground shrink-0">
          <Sparkles className="h-2.5 w-2.5 text-primary" />
          <span>§ STUDIO</span>
        </span>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col p-3 space-y-3.5">
          {/* Current Session Card */}
          <div className="rounded-2xl border border-border/80 bg-card/75 p-3.5 shadow-xs backdrop-blur-xs space-y-2.5 transition-all">
            <div className="flex items-center justify-between gap-2">
              <span className="ui-eyebrow text-[9.5px] font-mono tracking-wider text-muted-foreground">
                {t("session.currentWorld")}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-[10px] rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/40"
                onClick={onToggleSessionList}
                title={t("session.switchSession")}
              >
                <History className="w-3 h-3" />
                <span>{t("session.sessions", "Sessions")}</span>
              </Button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    session ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"
                  }`}
                />
                <Badge variant="secondary" className="text-[10px] font-medium rounded-md px-2 py-0.5">
                  {session.status} · turn {session.turnCount}
                </Badge>
              </div>
            </div>

            <p className="text-[10.5px] font-mono text-muted-foreground break-all leading-relaxed bg-background/50 p-2 rounded-lg border border-border/60">
              {session.id}
            </p>
          </div>

          {/* Session List Dropdown */}
          {showSessionList && (
            <div className="p-3 rounded-2xl border border-border/80 bg-muted/20 backdrop-blur-xs space-y-2 animate-in fade-in-0 duration-200">
              <h3 className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground font-mono">
                {t("session.sessions")}
              </h3>
              {otherSessions.length === 0 ? (
                <p className="text-[11px] text-muted-foreground italic py-1">
                  {t("session.noOtherSessions")}
                </p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto ui-scroll pr-1">
                  {otherSessions.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-1.5 rounded-xl bg-card/90 border border-border/80 p-1.5 hover:border-primary/50 transition-all shadow-2xs"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSwitchSession(s);
                          onCloseSessionList();
                        }}
                        className="flex-1 text-left px-2 py-1 text-[11px] font-mono truncate min-w-0 cursor-pointer"
                      >
                        <span className="block truncate font-medium text-foreground">{s.id}</span>
                        <span className="text-[9.5px] text-muted-foreground block truncate">
                          {s.status} · turn {s.turnCount} ·{" "}
                          {new Date(s.createdAt).toLocaleDateString()}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(s)}
                        className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                        title={t("common.delete", "Delete")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Models Section */}
          <div className="rounded-2xl border border-border/80 bg-card/65 p-3.5 shadow-xs backdrop-blur-xs space-y-3">
            <h3 className="ui-eyebrow text-[10.5px] font-mono tracking-wider text-muted-foreground">
              {t("session.activeModels", "Models")}
            </h3>
            <ActiveModelSlots slots={resolvedSlots} variant="compact" />
          </div>

          {/* Plugins Section */}
          <div className="rounded-2xl border border-border/80 bg-card/65 p-3.5 shadow-xs backdrop-blur-xs space-y-3">
            <h3 className="ui-eyebrow text-[10.5px] font-mono tracking-wider text-muted-foreground flex items-center justify-between">
              <span>{t("session.plugins", "Plugins")}</span>
              {enabledPackages.length > 0 && (
                <span className="rounded-full bg-primary/10 border border-primary/20 text-primary px-1.5 py-0.2 text-[9px] font-mono">
                  {enabledPackages.length}
                </span>
              )}
            </h3>
            <PluginListPanel
              packages={enabledPackages}
              loadErrors={pluginLoadErrors}
              sessionPlugins={sessionPlugins}
              executing={executing}
              onTogglePlugin={onTogglePlugin}
              resolvedSlots={resolvedSlots}
              sessionId={session.id}
              runtimeModelOverrides={session.runtimeModelOverrides}
              setupRuntimes={session.setupRuntimes}
            />
          </div>
        </div>
      </ScrollArea>

      {/* Bottom Sticky Action Bar */}
      <div className="p-3 border-t border-border/80 bg-card/50 backdrop-blur-md shrink-0 flex flex-col gap-2">
        <Button
          className="w-full h-9 text-xs rounded-xl border border-border/80 bg-background/80 hover:bg-accent/40 text-foreground transition-all"
          variant="outline"
          onClick={onOpenSettings}
        >
          <KeyRound className="w-3.5 h-3.5 mr-1.5 text-primary" />
          <span>{t("nav.settings", "Settings")}</span>
        </Button>
        <Button
          className="w-full h-8 text-[11px] rounded-xl text-muted-foreground hover:text-foreground transition-all"
          variant="ghost"
          onClick={onResetSession}
        >
          <RotateCcw className="w-3 h-3 mr-1.5" />
          <span>{t("session.worldConfig", "Configure World")}</span>
        </Button>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-xs rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {t("session.deleteConfirmTitle", "Delete session?")}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {t(
                "session.deleteConfirmDesc",
                "This permanently deletes session history.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs"
              onClick={() => setDeleteTarget(null)}
            >
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="rounded-xl text-xs"
              disabled={deleting}
              onClick={() => void handleConfirmDelete()}
            >
              {t("common.delete", "Delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
