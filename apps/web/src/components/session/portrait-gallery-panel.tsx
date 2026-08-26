import { useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon, Loader2, Upload, Sparkles } from "lucide-react";
import type { MediaRef } from "@covel/shared";
import { Media } from "@/components/Media.js";
import { MediaPreviewDialog } from "@/components/MediaPreviewDialog.js";
import { isMediaRef } from "@/lib/media-ref-utils.js";
import { usePluginNamespace } from "@/stores/plugin-data-store.js";
import { useActiveSessionId } from "@/lib/catalog/session-context.js";
import { uploadSessionMedia } from "@/services/api.js";
import { emitToast } from "@/lib/toast-channel.js";
import { requestConfirm } from "@/lib/confirm-channel.js";
import {
  emitPluginRpcRuntimeResponse,
  postPluginRpcWithApproval,
} from "./plugin-rpc-ui.js";

interface PresenceRecord {
  readonly characterId?: string;
  readonly displayName?: string;
  readonly avatar?: unknown;
  /** Optional full-body 立绘; rendered in preference to avatar when present. */
  readonly sprite?: unknown;
}

interface PresenceEntry {
  readonly key: string;
  readonly value: PresenceRecord;
}

/**
 * PortraitGalleryPanel — player-facing character portrait gallery.
 *
 * Shows each character's portrait as a framed, click-to-enlarge thumbnail, and
 * lets the player replace it by picking an image file.
 */
export function PortraitGalleryPanel({ pluginId }: { pluginId: string }): ReactElement {
  const { t } = useTranslation();
  const sessionId = useActiveSessionId();
  const presence = usePluginNamespace(pluginId, "presence");
  const [preview, setPreview] = useState<MediaRef | null>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  const entries = useMemo<PresenceEntry[]>(
    () =>
      Object.entries(presence).map(([key, value]) => ({
        key,
        value: (value ?? {}) as PresenceRecord,
      })),
    [presence],
  );

  async function replacePortrait(entry: PresenceEntry, file: File) {
    const characterId = entry.value.characterId;
    if (!sessionId || !characterId) return;
    setUploadingKey(entry.key);
    try {
      const ref = await uploadSessionMedia(sessionId, file);
      const response = await postPluginRpcWithApproval({
        sessionId,
        request: {
          pluginId,
          runtimeId: pluginId,
          payload: {
            presence: {
              schemaVersion: 1,
              characterId,
              ...(entry.value.displayName
                ? { displayName: entry.value.displayName }
                : {}),
              avatar: { id: ref.id, mime: ref.mime, size: ref.size },
              sprite: { id: ref.id, mime: ref.mime, size: ref.size },
            },
          },
        },
        pluginId,
        actionLabel: `runtime ${pluginId}`,
        confirm: requestConfirm,
        t,
      });
      if (response) {
        emitPluginRpcRuntimeResponse({
          response,
          t,
          runtimeId: pluginId,
          fallbackFailureMessage: t(
            "characterPresence.uploadFailed",
            "Portrait update failed",
          ),
        });
      }
    } catch (err) {
      emitToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingKey(null);
    }
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
        <ImageIcon className="w-8 h-8 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">
          {t(
            "characterPresence.empty",
            "This world ships no character portraits yet.",
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-in fade-in-0 duration-200">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground font-light">
          {t(
            "characterPresence.hint",
            "Click a portrait to enlarge, or hover and pick an image to replace it.",
          )}
        </p>
        <span className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-muted/40 px-2 py-0.5 text-[9px] font-mono text-muted-foreground shrink-0">
          <Sparkles className="h-2.5 w-2.5 text-primary" />
          <span>{entries.length}</span>
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {entries.map((entry) => {
          const ref = isMediaRef(entry.value.sprite)
            ? entry.value.sprite
            : isMediaRef(entry.value.avatar)
              ? entry.value.avatar
              : null;
          const busy = uploadingKey === entry.key;
          return (
            <div key={entry.key} className="space-y-1.5 min-w-0">
              <div className="group relative overflow-hidden rounded-2xl border border-border/80 bg-card/75 shadow-xs backdrop-blur-xs transition-all duration-300 hover:border-primary/50 hover:shadow-md hover:scale-[1.02]">
                <button
                  type="button"
                  className="block w-full cursor-zoom-in disabled:cursor-default"
                  onClick={() => ref && setPreview(ref)}
                  disabled={!ref}
                  aria-label={t(
                    "characterPresence.enlarge",
                    "Enlarge portrait",
                  )}
                >
                  {ref ? (
                    <Media
                      src={ref}
                      sessionId={sessionId}
                      alt={entry.value.displayName ?? ""}
                      aspectRatio="3/4"
                      rounded="none"
                      fit="cover"
                    />
                  ) : (
                    <div className="flex aspect-[3/4] items-center justify-center text-muted-foreground/40 bg-muted/20">
                      <ImageIcon className="h-6 w-6" />
                    </div>
                  )}
                </button>

                <label className="absolute inset-x-0 bottom-0 flex cursor-pointer items-center justify-center gap-1 bg-black/75 py-1.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100 backdrop-blur-xs">
                  {busy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="h-3 w-3" />
                  )}
                  <span>
                    {busy
                      ? t("characterPresence.uploading", "Uploading…")
                      : t("characterPresence.replace", "Replace")}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void replacePortrait(entry, file);
                    }}
                  />
                </label>
              </div>

              <span className="block truncate text-[11px] font-semibold text-foreground/90 px-0.5">
                {entry.value.displayName || entry.key}
              </span>
            </div>
          );
        })}
      </div>

      <MediaPreviewDialog
        mediaRef={preview}
        sessionId={sessionId}
        aspectRatio="3/4"
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
