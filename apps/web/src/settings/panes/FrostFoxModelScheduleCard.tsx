import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.js";
import {
  fetchFrostFoxAccount,
  fetchFrostFoxModelSchedule,
  getManagedFrostFoxCatalog,
  saveFrostFoxModelSchedule,
  subscribeManagedFrostFoxCatalog,
  type FrostFoxAccountStatus,
  type FrostFoxModelCatalog,
  type FrostFoxModelSchedule,
  type FrostFoxModelScheduleEntry,
} from "@/services/api.js";

interface ScheduleOption {
  readonly key: string;
  readonly entry: FrostFoxModelScheduleEntry;
  readonly label: string;
}

function entryKey(entry: FrostFoxModelScheduleEntry): string {
  return `${entry.channelKey}\n${entry.modelId}`;
}

function optionsFromCatalog(
  catalog: FrostFoxModelCatalog | null,
): ScheduleOption[] {
  if (!catalog) return [];
  return catalog.channels.flatMap((channel) =>
    channel.enabled && !channel.error
      ? channel.models
          .filter((model) => model.capability.output.includes("text"))
          .map((model) => ({
            key: entryKey({
              channelKey: channel.channelKey,
              modelId: model.id,
            }),
            entry: {
              channelKey: channel.channelKey,
              modelId: model.id,
            },
            label: `${channel.displayName} · ${model.name}`,
          }))
      : [],
  );
}

/**
 * Administrator-owned story model order. The first row is primary; remaining
 * rows are tried in order when the previous provider fails.
 */
export function FrostFoxModelScheduleCard() {
  const { t } = useTranslation();
  const [account, setAccount] = useState<FrostFoxAccountStatus | null>(null);
  const [catalog, setCatalog] = useState<FrostFoxModelCatalog | null>(() =>
    getManagedFrostFoxCatalog(),
  );
  const [schedule, setSchedule] = useState<FrostFoxModelSchedule | null>(null);
  const [draft, setDraft] = useState<FrostFoxModelScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canEditModels, setCanEditModels] = useState(false);

  useEffect(() => {
    const refreshCatalog = () => setCatalog(getManagedFrostFoxCatalog());
    refreshCatalog();
    return subscribeManagedFrostFoxCatalog(refreshCatalog);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetchFrostFoxAccount(true)
      .then((next) => {
        if (active) {
          setAccount(next);
          setCanEditModels(
            next.canEditModels === true ||
              next.operatorAuthorized === true ||
              next.account?.isAdmin === true,
          );
        }
        return next;
      })
      .then((next) => {
        if (!active || !next.enabled || !next.authenticated || !next.account) {
          return null;
        }
        return fetchFrostFoxModelSchedule(true);
      })
      .then((next) => {
        if (!active || !next) return;
        setSchedule(next);
        setCanEditModels((current) => current || next.canEdit === true);
        setDraft(next.story.map((entry) => ({ ...entry })));
      })
      .catch(() => {
        if (active) setError(t("settings.scheduleLoadFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [t]);

  const options = useMemo(() => optionsFromCatalog(catalog), [catalog]);
  const optionByKey = useMemo(
    () => new Map(options.map((option) => [option.key, option])),
    [options],
  );
  const isHostedAccount = Boolean(
    account?.enabled && account.authenticated && account.account,
  );
  const isAdmin = canEditModels;

  if (!isHostedAccount) return null;

  function updateEntry(index: number, key: string): void {
    const option = optionByKey.get(key);
    if (!option) return;
    if (
      draft.some(
        (entry, entryIndex) =>
          entryIndex !== index && entryKey(entry) === option.key,
      )
    ) {
      return;
    }
    setDraft((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...option.entry } : entry,
      ),
    );
    setError(null);
  }

  function moveEntry(index: number, direction: -1 | 1): void {
    setDraft((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      return next;
    });
  }

  function addEntry(): void {
    const used = new Set(draft.map(entryKey));
    const next = options.find((option) => !used.has(option.key));
    if (next) setDraft((current) => [...current, { ...next.entry }]);
  }

  function removeEntry(index: number): void {
    setDraft((current) =>
      current.filter((_, entryIndex) => entryIndex !== index),
    );
  }

  async function save(): Promise<void> {
    if (!isAdmin || saving) return;
    setSaving(true);
    setError(null);
    try {
      const next = await saveFrostFoxModelSchedule(draft);
      setSchedule(next);
      setDraft(next.story.map((entry) => ({ ...entry })));
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t("settings.scheduleSaveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }

  const changed =
    JSON.stringify(draft) !== JSON.stringify(schedule?.story ?? []);
  const canAdd =
    draft.length < 8 &&
    options.some(
      (option) => !draft.some((entry) => entryKey(entry) === option.key),
    );

  return (
    <section
      className="space-y-3 border border-primary/25 bg-primary/5 p-3"
      data-testid="frostfox-model-schedule"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
            {t("settings.storyModelSchedule")}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {t("settings.storyModelScheduleHint")}
          </p>
        </div>
        {schedule?.updatedAt && (
          <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
            {new Date(schedule.updatedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("settings.scheduleLoading")}
        </div>
      ) : (
        <>
          {!isAdmin && (
            <div className="border border-border/70 bg-background/50 px-2.5 py-2 text-[11px] text-muted-foreground">
              {t("settings.scheduleAdminOnly")}
            </div>
          )}

          {draft.length === 0 ? (
            <div className="border border-dashed border-border/80 px-3 py-2 text-[11px] text-muted-foreground">
              {t("settings.scheduleEmpty")}
            </div>
          ) : (
            <ol className="space-y-1.5">
              {draft.map((entry, index) => {
                const key = entryKey(entry);
                const option = optionByKey.get(key);
                return (
                  <li
                    key={`${key}-${index}`}
                    className="flex min-w-0 items-center gap-1.5 border border-border/70 bg-background/70 p-1.5"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-[10px] text-primary">
                      {index + 1}
                    </span>
                    <select
                      aria-label={t("settings.scheduleModelLabel", {
                        index: index + 1,
                      })}
                      value={key}
                      disabled={!isAdmin || saving}
                      onChange={(event) =>
                        updateEntry(index, event.target.value)
                      }
                      className="min-w-0 flex-1 border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
                    >
                      {!option && (
                        <option value={key}>
                          {t("settings.scheduleUnavailableModel", {
                            model: entry.modelId,
                          })}
                        </option>
                      )}
                      {options.map((candidate) => (
                        <option
                          key={candidate.key}
                          value={candidate.key}
                          disabled={draft.some(
                            (other, otherIndex) =>
                              otherIndex !== index &&
                              entryKey(other) === candidate.key,
                          )}
                        >
                          {candidate.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      disabled={!isAdmin || saving || index === 0}
                      onClick={() => moveEntry(index, -1)}
                      aria-label={t("settings.scheduleMoveUp")}
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      disabled={
                        !isAdmin || saving || index === draft.length - 1
                      }
                      onClick={() => moveEntry(index, 1)}
                      aria-label={t("settings.scheduleMoveDown")}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-destructive"
                      disabled={!isAdmin || saving}
                      onClick={() => removeEntry(index)}
                      aria-label={t("settings.scheduleRemove")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ol>
          )}

          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                disabled={!canAdd || saving}
                onClick={addEntry}
              >
                <Plus className="mr-1 h-3 w-3" />
                {t("settings.scheduleAddModel")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 text-[11px]"
                disabled={!changed || saving}
                onClick={() => void save()}
              >
                {saving ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Save className="mr-1 h-3 w-3" />
                )}
                {t("settings.scheduleSave")}
              </Button>
            </div>
          )}
        </>
      )}

      {error && (
        <p className="text-[11px] leading-relaxed text-destructive">{error}</p>
      )}
    </section>
  );
}
