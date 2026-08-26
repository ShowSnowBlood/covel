/**
 * WorldDocumentPanel — renders the current world's WORLD.md (lore field) as
 * Markdown in the right-panel "World" tab with high-end editorial styling,
 * cover visual hero card, tag chips, and polished typography.
 */

import type { CSSProperties, ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Sparkles, Tag } from "lucide-react";
import type { WorldRecord } from "@/services/api.js";
import { Markdown } from "@/components/ui/markdown.js";
import { text as resolveText } from "@/components/world/editor-helpers.js";
import { worldVisual } from "@/lib/world-visuals.js";
import { ShinyText } from "@/components/reactbits/index.js";

export interface WorldDocumentPanelProps {
  world: WorldRecord | null;
}

export function WorldDocumentPanel({ world }: WorldDocumentPanelProps): ReactElement {
  const { t } = useTranslation();

  if (!world) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
        <BookOpen className="w-8 h-8 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">
          {t("session.worldDocumentEmpty", "No world loaded")}
        </p>
      </div>
    );
  }

  const lore = resolveText(world.lore);
  const description = resolveText(world.description);
  const body = lore || description;
  const visual = worldVisual(world);
  const tags = (world.tags ?? []).map((item) => String(item));

  return (
    <div className="space-y-4 animate-in fade-in-0 duration-300">
      {/* Editorial World Header Hero Plate */}
      <div
        className="group relative overflow-hidden rounded-2xl border border-border/80 bg-card/75 shadow-md backdrop-blur-md transition-all duration-300 hover:border-primary/40 hover:shadow-xl"
        style={{ "--world-accent": visual.accent } as CSSProperties}
      >
        {/* Cover Artwork Background */}
        <div className="relative h-28 sm:h-32 w-full overflow-hidden">
          <img
            src={visual.image}
            alt=""
            aria-hidden="true"
            width={1536}
            height={1024}
            loading="eager"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
            draggable={false}
          />
          {/* Gradient Overlays */}
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, rgba(9,9,11,0.2) 0%, rgba(9,9,11,0.7) 60%, rgba(9,9,11,0.95) 100%), linear-gradient(90deg, rgba(9,9,11,0.85) 0%, rgba(9,9,11,0.4) 60%, rgba(9,9,11,0.2) 100%)",
            }}
          />
          {/* Accent Line */}
          <div
            aria-hidden="true"
            className="absolute left-0 top-0 h-1 w-20 transition-all duration-300 group-hover:w-36 shadow-[0_0_12px_var(--world-accent)]"
            style={{ background: "var(--world-accent)" }}
          />

          {/* Hero Content */}
          <div className="relative z-10 flex h-full flex-col justify-between p-3.5 sm:p-4 text-white">
            <div className="flex items-center justify-between gap-2">
              <span className="ui-eyebrow text-[9px] font-mono tracking-widest text-white/70">
                § WORLD ARCHIVE
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/40 px-2 py-0.5 text-[9px] font-medium text-white/80 backdrop-blur-md">
                <Sparkles className="h-2.5 w-2.5 text-amber-400" />
                <span>{world.id}</span>
              </span>
            </div>

            <div>
              <h2 className="ui-title text-base sm:text-lg font-bold leading-tight tracking-tight text-white drop-shadow-md">
                <ShinyText speed={5} shineColor="rgba(255, 255, 255, 0.95)">
                  {resolveText(world.name)}
                </ShinyText>
              </h2>
            </div>
          </div>
        </div>

        {/* Tags and Meta Chips Strip */}
        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 bg-muted/20 px-3.5 py-2">
            <Tag className="h-3 w-3 text-muted-foreground shrink-0 mr-0.5" />
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-border/80 bg-background/60 px-2 py-0.5 text-[10px] font-medium text-foreground/80 backdrop-blur-xs"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* World Document Lore Body */}
      {body ? (
        <article className="prose prose-sm dark:prose-invert max-w-none rounded-2xl border border-border/60 bg-card/40 p-4 shadow-xs backdrop-blur-xs text-[12px] leading-relaxed break-words [overflow-wrap:anywhere] space-y-3 prose-headings:font-display prose-headings:tracking-tight prose-headings:text-foreground prose-h1:text-base prose-h1:font-bold prose-h1:border-b prose-h1:border-border/60 prose-h1:pb-1.5 prose-h2:text-sm prose-h2:font-semibold prose-h2:text-primary prose-h3:text-xs prose-h3:font-semibold prose-p:text-foreground/90 prose-p:leading-relaxed prose-li:my-0.5 prose-blockquote:border-l-2 prose-blockquote:border-primary/60 prose-blockquote:bg-primary/5 prose-blockquote:py-1 prose-blockquote:px-3 prose-blockquote:rounded-r-lg prose-blockquote:italic prose-blockquote:text-muted-foreground prose-strong:text-foreground prose-strong:font-semibold">
          <Markdown>{body}</Markdown>
        </article>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
          <BookOpen className="w-6 h-6 text-muted-foreground/40" />
          <p className="text-xs text-muted-foreground">
            {t("session.worldDocumentEmpty", "No world document")}
          </p>
        </div>
      )}
    </div>
  );
}
