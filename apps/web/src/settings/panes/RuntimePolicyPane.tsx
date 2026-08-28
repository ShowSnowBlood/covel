import { useEffect, useMemo, useState } from "react";
import { Info, Loader2, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  normalizeRuntimeExecutionPolicy,
  RUNTIME_EXECUTION_POLICY_DEFAULTS,
  RUNTIME_EXECUTION_POLICY_FIELDS,
  RUNTIME_EXECUTION_POLICY_LIMITS,
  type RuntimeExecutionPolicy,
  type RuntimeExecutionPolicyField,
} from "@covel/shared";
import {
  fetchFrostFoxRuntimePolicy,
  saveFrostFoxRuntimePolicy,
} from "@/services/api.js";
import { Button } from "@/components/ui/button.js";

interface PolicyFieldDefinition {
  readonly field: RuntimeExecutionPolicyField;
  readonly labelKey: string;
  readonly fallbackLabel: string;
  readonly descriptionKey: string;
  readonly fallbackDescription: string;
  readonly unitKey: string;
  readonly fallbackUnit: string;
}

const FIELD_DEFINITIONS: readonly PolicyFieldDefinition[] = [
  {
    field: "timeoutMs",
    labelKey: "settings.runtimePolicy.timeoutMs",
    fallbackLabel: "Runtime timeout",
    descriptionKey: "settings.runtimePolicy.timeoutMsHint",
    fallbackDescription: "Maximum wall-clock time for one runtime.",
    unitKey: "settings.runtimePolicy.milliseconds",
    fallbackUnit: "ms",
  },
  {
    field: "callTimeoutMs",
    labelKey: "settings.runtimePolicy.callTimeoutMs",
    fallbackLabel: "Provider call / stream idle timeout",
    descriptionKey: "settings.runtimePolicy.callTimeoutMsHint",
    fallbackDescription:
      "Maximum time for one non-stream provider call, or silence between response bytes while streaming. Activity renews it; blank derives a budget from the runtime timeout and retry count.",

    unitKey: "settings.runtimePolicy.milliseconds",
    fallbackUnit: "ms",
  },
  {
    field: "firstTokenTimeoutMs",
    labelKey: "settings.runtimePolicy.firstTokenTimeoutMs",
    fallbackLabel: "First-response-byte timeout",
    descriptionKey: "settings.runtimePolicy.firstTokenTimeoutMsHint",
    fallbackDescription:
      "Maximum initial silence before any response byte on a streaming call.",

    unitKey: "settings.runtimePolicy.milliseconds",
    fallbackUnit: "ms",
  },
  {
    field: "maxRetries",
    labelKey: "settings.runtimePolicy.maxRetries",
    fallbackLabel: "Automatic retries",
    descriptionKey: "settings.runtimePolicy.maxRetriesHint",
    fallbackDescription:
      "Transient failures are retried this many times after the first attempt.",
    unitKey: "settings.runtimePolicy.attempts",
    fallbackUnit: "attempts",
  },
  {
    field: "maxSteps",
    labelKey: "settings.runtimePolicy.maxSteps",
    fallbackLabel: "Tool-loop steps",
    descriptionKey: "settings.runtimePolicy.maxStepsHint",
    fallbackDescription: "Maximum tool-calling steps for an agent runtime.",
    unitKey: "settings.runtimePolicy.steps",
    fallbackUnit: "steps",
  },
  {
    field: "loopDetectionThreshold",
    labelKey: "settings.runtimePolicy.loopDetectionThreshold",
    fallbackLabel: "Loop detection threshold",
    descriptionKey: "settings.runtimePolicy.loopDetectionThresholdHint",
    fallbackDescription:
      "Retry after this many identical consecutive tool calls. Zero disables detection.",
    unitKey: "settings.runtimePolicy.calls",
    fallbackUnit: "calls",
  },
];

function draftFromPolicy(
  policy: RuntimeExecutionPolicy,
): Record<string, string> {
  return Object.fromEntries(
    RUNTIME_EXECUTION_POLICY_FIELDS.map((field) => [
      field,
      policy[field] === undefined ? "" : String(policy[field]),
    ]),
  );
}

function policyFromDraft(
  draft: Record<string, string>,
): RuntimeExecutionPolicy | null {
  const raw: Record<string, number> = {};
  for (const field of RUNTIME_EXECUTION_POLICY_FIELDS) {
    const value = draft[field]?.trim() ?? "";
    if (!value) continue;
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) return null;
    raw[field] = parsed;
  }
  return normalizeRuntimeExecutionPolicy(raw);
}

function defaultLabel(
  definition: PolicyFieldDefinition,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const value = RUNTIME_EXECUTION_POLICY_DEFAULTS[definition.field];
  if (value === undefined) {
    return t("settings.runtimePolicy.derived", {
      defaultValue: "Derived automatically",
    });
  }
  return `${value.toLocaleString()} ${t(definition.unitKey, {
    defaultValue: definition.fallbackUnit,
  })}`;
}

export function RuntimePolicyPane() {
  const { t } = useTranslation();
  const [policy, setPolicy] = useState<RuntimeExecutionPolicy>({});
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    draftFromPolicy({}),
  );
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetchFrostFoxRuntimePolicy()
      .then((response) => {
        if (!active) return;
        const next = normalizeRuntimeExecutionPolicy(response.policy) ?? {};
        setPolicy(next);
        setDraft(draftFromPolicy(next));
        setUpdatedAt(response.updatedAt ?? null);
      })
      .catch((nextError) => {
        if (active) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : t("settings.runtimePolicy.loadFailed"),
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [t]);

  const parsedDraft = useMemo(() => policyFromDraft(draft), [draft]);
  const changed = JSON.stringify(parsedDraft ?? {}) !== JSON.stringify(policy);

  function updateField(field: RuntimeExecutionPolicyField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  async function save(): Promise<void> {
    if (!parsedDraft || saving) {
      if (!parsedDraft) setError(t("settings.runtimePolicy.invalidValue"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await saveFrostFoxRuntimePolicy(parsedDraft);
      const next = normalizeRuntimeExecutionPolicy(response.policy) ?? {};
      setPolicy(next);
      setDraft(draftFromPolicy(next));
      setUpdatedAt(response.updatedAt ?? null);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t("settings.runtimePolicy.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }

  function clearDraft(): void {
    setDraft(draftFromPolicy({}));
    setError(null);
  }

  return (
    <section className="min-w-0 space-y-4" data-testid="runtime-policy-pane">
      <div className="flex items-start gap-2 border border-primary/25 bg-primary/5 px-3 py-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="space-y-1.5">
          <p className="font-medium text-foreground">
            {t("settings.runtimePolicy.title", {
              defaultValue: "Runtime execution policy",
            })}
          </p>
          <p className="leading-relaxed">
            {t("settings.runtimePolicy.description", {
              defaultValue:
                "These limits apply to every hosted session. Players cannot override them from the home or session surfaces.",
            })}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 border border-border/60 bg-muted/20 px-3 py-2.5 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p className="leading-relaxed">
          {t("settings.runtimePolicy.inheritHint", {
            defaultValue:
              "Blank fields keep each runtime manifest's value. A saved value becomes the server-wide administrator override.",
          })}
        </p>
      </div>

      <fieldset disabled={loading || saving} className="space-y-3">
        {FIELD_DEFINITIONS.map((definition) => {
          const limits = RUNTIME_EXECUTION_POLICY_LIMITS[definition.field];
          const value = draft[definition.field] ?? "";
          return (
            <label
              key={definition.field}
              className="block border border-border bg-background p-3"
            >
              <span className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-foreground">
                  {t(definition.labelKey, {
                    defaultValue: definition.fallbackLabel,
                  })}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {t(definition.unitKey, {
                    defaultValue: definition.fallbackUnit,
                  })}
                </span>
              </span>
              <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">
                {t(definition.descriptionKey, {
                  defaultValue: definition.fallbackDescription,
                })}
              </span>
              <span className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  value={value}
                  min={limits.min}
                  max={limits.max}
                  step={limits.step}
                  placeholder={defaultLabel(definition, t)}
                  onChange={(event) =>
                    updateField(definition.field, event.target.value)
                  }
                  className="min-w-0 flex-1 border border-border bg-background px-3 py-2 text-sm font-mono tabular-nums outline-none focus:ring-1 focus:ring-primary"
                />
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {limits.min.toLocaleString()}–{limits.max.toLocaleString()}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("settings.runtimePolicy.loading", {
            defaultValue: "Loading runtime policy",
          })}
        </div>
      )}
      {updatedAt && !loading && (
        <p className="font-mono text-[10px] text-muted-foreground">
          {t("settings.runtimePolicy.updatedAt", {
            value: new Date(updatedAt).toLocaleString(),
            defaultValue: "Updated {{value}}",
          })}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs leading-relaxed text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || saving || !changed}
          onClick={clearDraft}
          className="text-xs"
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          {t("settings.runtimePolicy.clear", {
            defaultValue: "Use manifest defaults",
          })}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={loading || saving || !changed || !parsedDraft}
          onClick={() => void save()}
          className="text-xs"
        >
          {saving ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="mr-1.5 h-3.5 w-3.5" />
          )}
          {t("settings.runtimePolicy.save", {
            defaultValue: "Save policy",
          })}
        </Button>
      </div>
    </section>
  );
}
