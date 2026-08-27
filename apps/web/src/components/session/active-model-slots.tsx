import { Cpu, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card.js";
import { Badge } from "@/components/ui/badge.js";
import { PingButton } from "@/components/shared/ping-button.js";
import type { ResolvedSlot } from "@/hooks/use-slot-config.js";

/**
 * Displays the model slots used by the current session.
 *
 * Each row embeds a <PingButton> so the user can verify connectivity /
 * latency without leaving the game view. Results are cached for 60s at
 * the PingButton layer, so repeat clicks are free until the cache expires.
 *
 * Variants:
 *   - `card` — used on the prep screen; shows model and Ping inline.
 *   - `compact` — used in the session sidebar; uses the icon-only variant
 *     to fit the narrow column.
 */
export function ActiveModelSlots({
  slots,
  variant = "card",
  modelControlsLocked = false,
}: {
  slots: ResolvedSlot[];
  variant?: "card" | "compact";
  /** Hosted player model routing is administrator-owned. */
  modelControlsLocked?: boolean;
}) {
  const { t } = useTranslation();

  if (slots.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        {t("session.noModelsConfigured")}
      </p>
    );
  }

  if (variant === "compact") {
    return (
      <div className="flex flex-wrap gap-1.5">
        {slots.map((slot) => {
          const modelName = slot.preset?.model ?? slot.serverModel ?? "unknown";
          const provider = slot.preset?.provider ?? slot.serverProvider ?? "";
          const tooltip = [slot.label, provider, modelName]
            .filter(Boolean)
            .join(" · ");
          return (
            <div
              key={slot.slotId}
              className="inline-flex min-w-0 items-center gap-1 rounded-md border border-border/70 bg-muted/20 px-1.5 py-1"
              title={tooltip}
            >
              <span className="max-w-[5.5rem] truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {slot.label}
              </span>
              {slot.tag === "text" ? (
                <PingButton
                  target={{ kind: "slot", slotId: slot.slotId }}
                  variant="icon"
                  size="xs"
                />
              ) : (
                <span className="text-[9px] text-muted-foreground/60">
                  {slot.tag}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {modelControlsLocked && (
        <div className="flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 text-[11px] text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="leading-relaxed">
            {t(
              "session.modelsManagedByAdmin",
              "Model routing is managed by your administrator.",
            )}
          </span>
        </div>
      )}
      {slots.map((slot) => {
        const modelName = slot.preset?.model ?? slot.serverModel ?? "unknown";
        const displayName =
          slot.preset?.name ?? slot.serverModel ?? slot.presetId;
        return (
          <Card key={slot.slotId}>
            <CardContent className="space-y-2 p-3">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-2">
                  <Cpu className="w-4 h-4 shrink-0 text-primary" />
                  <span className="min-w-0 truncate text-sm font-medium">
                    {displayName}
                  </span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:justify-end">
                  <Badge
                    variant="outline"
                    className="shrink-0 text-[10px] uppercase"
                  >
                    {slot.label}
                  </Badge>
                  <Badge
                    variant="default"
                    className="max-w-full shrink-0 truncate"
                    title={modelName}
                  >
                    {modelName}
                  </Badge>
                </div>
              </div>
              <div className="flex min-w-0 items-center justify-end">
                {slot.tag === "text" ? (
                  <PingButton
                    target={{ kind: "slot", slotId: slot.slotId }}
                    size="xs"
                  />
                ) : (
                  <span className="text-[10px] text-muted-foreground">
                    {slot.tag}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
