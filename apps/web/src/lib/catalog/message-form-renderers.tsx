import type { ComponentRenderer } from "@json-render/react";
import { useStateStore } from "@json-render/react";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";
import { useI18nResolver } from "./helpers.js";

// ── Message Components (for chat area rendering) ─────────────────

/** Prose — renders narrative text as styled paragraphs. */
export const Prose: ComponentRenderer = ({ element }) => {
  const content = (element.props?.content as string) ?? "";
  const paragraphs = content.split(/\n\n+/).filter(Boolean);

  return (
    <div className="ui-narrative space-y-5 max-w-[var(--story-max-width)]">
      {paragraphs.map((p, i) => (
        <p key={i} className="text-sm text-foreground leading-relaxed">
          {p.split(/(\*\*[^*]+\*\*)/).map((segment, j) =>
            segment.startsWith("**") && segment.endsWith("**") ? (
              <strong key={j} className="font-semibold">
                {segment.slice(2, -2)}
              </strong>
            ) : (
              segment
            ),
          )}
        </p>
      ))}
    </div>
  );
};

/** PlayerMessage — renders player's input message (right-aligned bubble).
 *  In Paper, follows Variant A's editorial "YOU" convention: left-aligned
 *  with a 2px accent bar and a mono uppercase eyebrow. */
export const PlayerMessage: ComponentRenderer = ({ element }) => {
  const { t } = useTranslation();
  const content = (element.props?.content as string) ?? "";
  return (
    <div className="ui-player-message-row flex justify-end">
      <div className="ui-message-player max-w-[80%] px-4 py-2.5 text-sm leading-relaxed">
        <span className="ui-eyebrow mb-1 block text-primary">
          {t("interaction.playerLabel", "You")}
        </span>
        <span className="text-[14px] leading-[1.6]">{content}</span>
      </div>
    </div>
  );
};

/** Alert — renders notifications (info, success, warning, error). */
export const Alert: ComponentRenderer = ({ element }) => {
  const resolve = useI18nResolver();
  const level = (element.props?.level as string) ?? "info";
  const title = resolve(element.props?.title);
  const message = resolve(element.props?.message);

  const toneMap: Record<string, "success" | "warning" | "danger" | "info"> = {
    success: "success",
    warning: "warning",
    error: "danger",
    info: "info",
  };
  const textColorMap: Record<string, string> = {
    success: "text-[var(--accent-success)]",
    warning: "text-[var(--accent-warning)]",
    error: "text-[var(--accent-danger)]",
    info: "text-[var(--accent-secondary)]",
  };

  return (
    <div className="ui-band text-sm" data-tone={toneMap[level]}>
      {title && (
        <div
          className={clsx(
            "ui-eyebrow font-medium text-[11px] mb-1",
            textColorMap[level],
          )}
        >
          {title}
        </div>
      )}
      {message && (
        <div className="text-[13px] leading-[1.55] text-foreground/90">
          {message}
        </div>
      )}
    </div>
  );
};

/** FormField — a single form field (text input or select). */
export const FormField: ComponentRenderer = ({ element, bindings }) => {
  const { t } = useTranslation();
  const resolve = useI18nResolver();
  const fieldType = (element.props?.fieldType as string) ?? "text";
  const label = resolve(element.props?.label);
  const placeholder = resolve(element.props?.placeholder);
  const required = element.props?.required as boolean;
  const options = element.props?.options as
    Array<{ value: string; label: string }> | undefined;
  const value = (element.props?.value as string) ?? "";
  const disabled = element.props?.disabled as boolean;
  const { set } = useStateStore();
  const bindPath = bindings?.value;

  const fieldCls =
    "ui-input-shell w-full rounded-xl border border-border/80 bg-background/80 px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 disabled:opacity-50 text-foreground placeholder:text-muted-foreground shadow-xs backdrop-blur-xs";

  return (
    <div className="space-y-1.5">
      <label className="ui-eyebrow text-xs text-muted-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {fieldType === "select" && options ? (
        <select
          value={value}
          onChange={(e) => bindPath && set(bindPath, e.target.value)}
          disabled={disabled}
          className={fieldCls}
        >
          <option value="">
            {placeholder ?? t("form.selectPrefix", { label })}
          </option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => bindPath && set(bindPath, e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={fieldCls}
        />
      )}
    </div>
  );
};

/** SubmitButton — styled form submit button with disabled state. */
export const SubmitButton: ComponentRenderer = ({ element, emit }) => {
  const resolve = useI18nResolver();
  const label = resolve(element.props?.label);
  const disabled = element.props?.disabled as boolean;

  return (
    <button
      type="button"
      data-testid="interaction-submit"
      onClick={() => emit("click")}
      disabled={disabled}
      className={clsx(
        "w-full py-3 text-sm font-semibold rounded-xl transition-all duration-200 shadow-xs hover:shadow-md hover:scale-[1.01] active:scale-[0.99] tracking-wide",
        disabled
          ? "bg-muted text-muted-foreground cursor-not-allowed"
          : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_12px_rgba(var(--primary),0.2)]",
      )}
    >
      {label}
    </button>
  );
};
