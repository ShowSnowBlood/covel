import { useState } from "react";
import { Search, Tag, ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.js";

interface PluginFilterBarProps {
  pluginSearch: string;
  onPluginSearchChange: (value: string) => void;
  availablePluginTags: string[];
  activePluginTags: ReadonlySet<string>;
  onTogglePluginTag: (tag: string) => void;
}

export function PluginFilterBar({
  pluginSearch,
  onPluginSearchChange,
  availablePluginTags,
  activePluginTags,
  onTogglePluginTag,
}: PluginFilterBarProps) {
  const { t } = useTranslation();
  const [showTags, setShowTags] = useState(false);
  const activeCount = activePluginTags.size;

  return (
    <div className="flex flex-col gap-2 mb-2.5">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-border/80 bg-background/50 px-3 py-1.5 backdrop-blur-xs transition-all focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            value={pluginSearch}
            onChange={(event) => onPluginSearchChange(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            placeholder={t(
              "session.searchPlugins",
              "Search plugins, tags, capabilities",
            )}
          />
        </div>

        {availablePluginTags.length > 0 && (
          <Button
            type="button"
            variant={showTags || activeCount > 0 ? "secondary" : "ghost"}
            size="sm"
            className="h-8 gap-1.5 px-3 text-xs rounded-xl"
            onClick={() => setShowTags((prev) => !prev)}
          >
            <Tag className="w-3 h-3" />
            <span>{t("session.filterTags", "Tags")}</span>
            {activeCount > 0 && (
              <span className="ml-0.5 rounded-full bg-primary px-1.5 py-0.2 text-[9px] font-bold text-primary-foreground">
                {activeCount}
              </span>
            )}
            {showTags ? (
              <ChevronUp className="w-3 h-3 ml-0.5 opacity-60" />
            ) : (
              <ChevronDown className="w-3 h-3 ml-0.5 opacity-60" />
            )}
          </Button>
        )}
      </div>

      {showTags && availablePluginTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2.5 rounded-xl border border-border/60 bg-muted/20 backdrop-blur-xs animate-in fade-in-0 duration-200">
          {availablePluginTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`rounded-lg border px-2 py-0.5 text-[10px] font-mono transition-all cursor-pointer ${
                activePluginTags.has(tag)
                  ? "border-primary bg-primary text-primary-foreground font-semibold shadow-xs"
                  : "border-border/80 bg-card/60 text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              }`}
              onClick={() => onTogglePluginTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
