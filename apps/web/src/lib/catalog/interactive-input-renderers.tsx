import type { ComponentRenderer } from "@json-render/react";
import { clsx } from "clsx";
import * as Icons from "lucide-react";
import { useI18nResolver } from "./helpers.js";
import { useFormInputBinding } from "./use-form-input-binding.js";

// Shared base class for all text-input shells.
export const inputBase =
  "ui-input-shell w-full rounded-xl border border-border/80 bg-background/80 px-3 py-2 text-xs outline-none transition-all duration-150 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 text-foreground placeholder:text-muted-foreground shadow-xs backdrop-blur-xs";

/** Shared presentational label for form inputs. */
function FormInputLabel({ label }: { label: string }) {
  if (!label) return null;
  return (
    <label className="ui-eyebrow text-xs text-muted-foreground">{label}</label>
  );
}

export const Input: ComponentRenderer = ({ element, bindings }) => {
  const resolve = useI18nResolver();
  const placeholder = resolve(element.props?.placeholder);
  const { label, value, onChange } = useFormInputBinding(
    element.props?.label,
    element.props?.value,
    bindings?.value,
  );

  return (
    <div className="space-y-1">
      <FormInputLabel label={label} />
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={inputBase}
      />
    </div>
  );
};

export const Textarea: ComponentRenderer = ({ element, bindings }) => {
  const resolve = useI18nResolver();
  const placeholder = resolve(element.props?.placeholder);
  const rows = (element.props?.rows as number) ?? 8;
  const { label, value, onChange } = useFormInputBinding(
    element.props?.label,
    element.props?.value,
    bindings?.value,
  );

  return (
    <div className="space-y-1">
      <FormInputLabel label={label} />
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={clsx(
          inputBase,
          "min-h-[160px] resize-y font-mono leading-relaxed",
        )}
      />
    </div>
  );
};

export const SearchInput: ComponentRenderer = ({ element, bindings }) => {
  const resolve = useI18nResolver();
  const placeholder = resolve(element.props?.placeholder);
  const { value, onChange } = useFormInputBinding(
    undefined,
    element.props?.value,
    bindings?.value,
  );
  const SearchIcon = Icons.Search;

  return (
    <div className="relative">
      <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={clsx(inputBase, "pl-7 pr-3")}
      />
    </div>
  );
};
