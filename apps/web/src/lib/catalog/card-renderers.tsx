import { Children, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ComponentRenderer } from "@json-render/react";
import { clsx } from "clsx";
import * as Icons from "lucide-react";
import { resolveIcon, toTextArray, useI18nResolver } from "./helpers.js";
import { useCollapsible } from "./use-collapsible.js";
import {
  categoryIconColors,
  categoryIcons,
  rarityBadgeColors,
  rarityMarkerColor,
  rarityTone,
} from "./catalog-constants.js";

export const Card: ComponentRenderer = ({ element, children }) => {
  const variant = element.props?.variant as string;
  const collapsible = (element.props?.collapsible as boolean) ?? false;
  const defaultExpanded = (element.props?.defaultExpanded as boolean) ?? false;
  const { expanded, toggle } = useCollapsible(defaultExpanded);

  let body: ReactNode = children;
  if (collapsible) {
    const items = Children.toArray(children);
    const head = items[0];
    const rest = items.slice(1);
    const Chevron = expanded ? Icons.ChevronDown : Icons.ChevronRight;
    body = (
      <>
        <div
          className="flex items-center gap-2 cursor-pointer select-none py-0.5"
          onClick={toggle}
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggle();
            }
          }}
        >
          <Chevron
            className="w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform duration-200"
            aria-hidden="true"
          />
          <div className="flex-1 min-w-0">{head}</div>
        </div>
        {expanded && <div className="animate-in fade-in-0 duration-200">{rest}</div>}
      </>
    );
  }

  // Variants:
  //   glow    → highlighted band with primary marker
  //   subtle  → quiet section with just internal padding & breathable spacing
  //   frame   → opt-in enclosed frame for cases that genuinely need walls
  if (variant === "frame") {
    return (
      <div className="rounded-2xl border border-border/80 bg-card/75 p-3.5 sm:p-4 shadow-xs backdrop-blur-xs space-y-2.5">
        {body}
      </div>
    );
  }
  if (variant === "subtle") {
    return (
      <div className="rounded-xl px-3 py-2.5 space-y-2 border-l-2 border-primary/40 bg-muted/20 hover:border-primary transition-colors">
        {body}
      </div>
    );
  }
  return (
    <div
      className="group relative overflow-hidden rounded-xl border border-border/70 bg-card/60 p-3 shadow-2xs backdrop-blur-xs transition-all duration-200 hover:border-primary/40 hover:shadow-xs space-y-2"
      data-tone={variant === "glow" ? undefined : "muted"}
    >
      {body}
    </div>
  );
};

export const CardList: ComponentRenderer = ({ children }) => {
  return <div className="space-y-2.5">{children}</div>;
};

export const EntryCard: ComponentRenderer = ({ element }) => {
  const { t } = useTranslation();
  const resolve = useI18nResolver();
  const title = resolve(element.props?.title);
  const category = (element.props?.category as string) ?? "";
  const content = resolve(element.props?.content);
  const tags = toTextArray(element.props?.tags);
  const rarity = (element.props?.rarity as string) ?? "common";

  const externalIcon = element.props?.icon as string | undefined;
  const externalColor = element.props?.color as string | undefined;
  const collapsible = (element.props?.collapsible as boolean) ?? false;
  const defaultExpanded = (element.props?.defaultExpanded as boolean) ?? true;
  const isNew = (element.props?.isNew as boolean) ?? false;
  const isActive = (element.props?.isActive as boolean) ?? false;

  const { expanded, toggle } = useCollapsible(defaultExpanded);

  const CategoryIcon = resolveIcon(
    externalIcon ?? categoryIcons[category] ?? "book-open",
  );
  const iconColorClass = externalColor
    ? `${categoryIconColors[externalColor] ?? "text-primary"}`
    : "text-primary";
  const Chevron = expanded ? Icons.ChevronDown : Icons.ChevronRight;
  const SparkleIcon = Icons.Sparkles;
  const ActiveIcon = Icons.CircleCheck ?? Icons.Check;

  const showBody = !collapsible || expanded;
  const titleRowClass = clsx(
    "flex items-center gap-2",
    collapsible && "cursor-pointer select-none",
  );

  const markerColor = rarityMarkerColor[rarity] || "var(--accent-primary)";

  return (
    <div
      className="group relative overflow-hidden rounded-xl border border-border/75 bg-card/70 p-3 shadow-2xs backdrop-blur-xs transition-all duration-200 hover:border-primary/45 hover:shadow-xs space-y-2"
      data-tone={rarityTone[rarity] ?? "muted"}
      style={{ ["--tw-band-marker" as string]: markerColor }}
    >
      {/* Colored Left Accent Line */}
      <div
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 w-[3px] opacity-80 group-hover:opacity-100 transition-opacity"
        style={{ background: markerColor }}
      />

      <div
        className={titleRowClass}
        onClick={collapsible ? toggle : undefined}
        role={collapsible ? "button" : undefined}
        tabIndex={collapsible ? 0 : undefined}
        aria-expanded={collapsible ? expanded : undefined}
        onKeyDown={
          collapsible
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle();
                }
              }
            : undefined
        }
      >
        {collapsible && (
          <Chevron
            className="w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform duration-200"
            aria-hidden="true"
          />
        )}
        {CategoryIcon && (
          <CategoryIcon
            className={clsx("w-3.5 h-3.5 shrink-0", iconColorClass)}
          />
        )}
        <span className="ui-entry-title text-[12.5px] sm:text-[13px] font-semibold flex-1 truncate text-foreground">
          {title}
        </span>
        {isActive && (
          <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.2 text-[9px] font-semibold text-emerald-600 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30">
            {ActiveIcon && <ActiveIcon className="w-2.5 h-2.5" />}
            {t("common.active", "Active")}
          </span>
        )}
        {isNew && (
          <span
            className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.2 text-[9px] font-semibold tracking-wider uppercase text-purple-600 dark:text-purple-300 bg-purple-500/10 border border-purple-500/30"
            aria-label={t("common.new", "new")}
          >
            <SparkleIcon className="w-2.5 h-2.5" />
            {t("common.newUpper", "NEW")}
          </span>
        )}
        {category && (
          <span
            className={clsx(
              "inline-flex items-center rounded-md px-1.5 py-0.5 text-[9.5px] font-medium border",
              rarityBadgeColors[rarity],
            )}
          >
            {category}
          </span>
        )}
      </div>
      {showBody && content && (
        <p className="text-[12px] text-muted-foreground leading-relaxed pl-1">
          {content}
        </p>
      )}
      {showBody && tags && tags.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-1 pt-0.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-border/80 bg-muted/40 px-1.5 py-0.2 text-[9px] font-mono text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
