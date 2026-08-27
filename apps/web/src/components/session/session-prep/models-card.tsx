import { Cpu, KeyRound, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent } from "@/components/ui/card.js";
import { ActiveModelSlots } from "../active-model-slots.js";
import type { ResolvedSlot } from "@/hooks/use-slot-config.js";
import { useFrostFoxAccountOptional } from "@/components/frostfox-account-summary.js";
import { CollapsibleCardHeader } from "./collapsible-card-header.js";

interface ModelsCardProps {
  resolvedSlots: ResolvedSlot[];
  expanded: boolean;
  onToggle: () => void;
  onOpenSettings: () => void;
}

export function ModelsCard({
  resolvedSlots,
  expanded,
  onToggle,
  onOpenSettings,
}: ModelsCardProps) {
  const { t } = useTranslation();
  const frostFoxAccount = useFrostFoxAccountOptional?.() ?? null;
  const modelControlsLocked = Boolean(
    frostFoxAccount?.status?.enabled &&
    frostFoxAccount.status.authenticated &&
    frostFoxAccount.status.account &&
    frostFoxAccount.status.account.isAdmin !== true,
  );
  return (
    <Card>
      <CollapsibleCardHeader
        expanded={expanded}
        onToggle={onToggle}
        summary={
          resolvedSlots.length > 0
            ? t("session.slotsConfigured", {
                count: resolvedSlots.length,
              })
            : t("session.slotsUnconfigured")
        }
      >
        <Cpu className="w-4 h-4" />
        {t("session.activeModels", "Active Models")}
        <Badge variant="secondary" className="text-[10px] ml-1">
          {resolvedSlots.length}
        </Badge>
      </CollapsibleCardHeader>
      {expanded && (
        <CardContent className="space-y-2 px-4 pb-4">
          <ActiveModelSlots
            slots={resolvedSlots}
            modelControlsLocked={modelControlsLocked}
          />
          {!modelControlsLocked ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 text-xs"
              onClick={onOpenSettings}
            >
              <KeyRound className="w-3.5 h-3.5 mr-1.5" />
              {t("session.configureModelRoles", "Configure model roles")}
            </Button>
          ) : (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Lock className="h-3 w-3 text-primary" />
              {t(
                "session.modelsManagedByAdmin",
                "Model routing is managed by your administrator.",
              )}
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
