// Adapted from React Bits Accordion Gallery by David Haz.
// Copyright (c) 2026 David Haz. Licensed under the MIT + Commons Clause
// License Condition v1.0 for use as part of this application.
// Source: https://reactbits.dev/components/accordion-gallery

import { gsap } from "gsap";
import type { TFunction } from "i18next";
import { ArrowRight, Check, Eye, LockKeyhole, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import { text } from "@/components/world/editor-helpers.js";
import { worldVisual } from "@/lib/world-visuals.js";
import type { WorldRecord } from "@/services/api.js";
import { ShinyText } from "@/components/reactbits/index.js";

import "./level-accordion-gallery.css";

export interface LevelAccordionItem {
  readonly world: WorldRecord;
  readonly levelNumber: number;
  readonly locked: boolean;
  readonly completed: boolean;
  readonly unlocking: boolean;
  readonly lockLabel?: string;
  readonly isEntering: boolean;
  readonly dimmed: boolean;
}

interface LevelAccordionGalleryProps {
  readonly items: readonly LevelAccordionItem[];
  readonly defaultIndex: number;
  readonly t: TFunction;
  readonly onEnter: (worldId: string) => void;
  readonly onLocked?: () => void;
  readonly onViewDetails: (event: MouseEvent, worldId: string) => void;
  readonly onDelete: (event: MouseEvent, worldId: string) => void;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function isCompactViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 767px)").matches
  );
}

export function LevelAccordionGallery({
  items,
  defaultIndex,
  t,
  onEnter,
  onLocked,
  onViewDetails,
  onDelete,
}: LevelAccordionGalleryProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<(HTMLElement | null)[]>([]);
  const mediaRefs = useRef<(HTMLElement | null)[]>([]);
  const contentRefs = useRef<(HTMLElement | null)[]>([]);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const firstLayoutRef = useRef(true);
  const [compact, setCompact] = useState(isCompactViewport);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.min(Math.max(defaultIndex, 0), Math.max(items.length - 1, 0)),
  );

  useEffect(() => {
    setActiveIndex((current) =>
      current >= items.length
        ? Math.max(items.length - 1, 0)
        : Math.min(Math.max(defaultIndex, 0), Math.max(items.length - 1, 0)),
    );
  }, [defaultIndex, items.length]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const applyLayout = useCallback(
    (animate: boolean) => {
      const reduced = prefersReducedMotion();
      const duration = animate && !reduced ? 0.58 : 0;
      timelineRef.current?.kill();
      const timeline = gsap.timeline();

      panelRefs.current.forEach((panel, index) => {
        if (!panel) return;
        const active = index === activeIndex;
        const media = mediaRefs.current[index];
        const content = contentRefs.current[index];
        const tilt = compact
          ? 0
          : active
            ? 0
            : index < activeIndex
              ? 1.4
              : -1.4;

        timeline.to(
          panel,
          {
            flexGrow: active ? (compact ? 3.6 : 4.4) : 1,
            rotateY: tilt,
            duration,
            ease: "power3.out",
          },
          0,
        );
        if (media) {
          timeline.to(
            media,
            {
              scale: active ? 1.015 : 1.085,
              xPercent: compact ? 0 : active ? 0 : index < activeIndex ? -3 : 3,
              duration,
              ease: "power3.out",
            },
            0,
          );
        }
        if (content) {
          timeline.to(
            content,
            {
              autoAlpha: active ? 1 : compact ? 0.45 : 0,
              y: active ? 0 : 12,
              duration: duration * 0.78,
              ease: "power2.out",
            },
            0,
          );
        }
      });

      timelineRef.current = timeline;
    },
    [activeIndex, compact],
  );

  useEffect(() => {
    applyLayout(!firstLayoutRef.current);
    firstLayoutRef.current = false;
  }, [applyLayout]);

  useEffect(
    () => () => {
      timelineRef.current?.kill();
    },
    [],
  );

  function activate(index: number) {
    if (index !== activeIndex) setActiveIndex(index);
  }

  function handlePanelAction(index: number) {
    const item = items[index];
    if (!item || item.unlocking || item.dimmed) return;
    if (index !== activeIndex) {
      setActiveIndex(index);
      return;
    }
    if (item.locked) onLocked?.();
    else onEnter(item.world.id);
  }

  function handleKeyDown(index: number, event: KeyboardEvent) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index + 1) % items.length);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index - 1 + items.length) % items.length);
    }
  }

  if (items.length === 0) return null;

  return (
    <div
      ref={rootRef}
      className="level-accordion-gallery"
      role="list"
      aria-label={t("session.campaignRoute", "Campaign route")}
    >
      {items.map((item, index) => {
        const active = index === activeIndex;
        const visual = worldVisual(item.world);
        const available = !item.locked && !item.unlocking;
        const statusLabel = item.completed
          ? t("session.levelCompleted", "Completed")
          : item.unlocking
            ? t("session.levelUnlocking", "Unlocking")
            : item.locked
              ? t("session.levelLocked", "Locked")
              : t("session.levelAvailable", "Available");

        return (
          <article
            key={item.world.id}
            ref={(element) => {
              panelRefs.current[index] = element;
            }}
            role="listitem"
            aria-busy={item.isEntering}
            aria-disabled={item.locked || item.unlocking}
            aria-current={active ? "true" : undefined}
            className={`level-accordion-panel ${
              active ? "level-accordion-panel-active" : ""
            } ${item.locked ? "level-accordion-panel-locked" : ""} ${
              item.unlocking ? "level-accordion-panel-unlocking" : ""
            } ${item.dimmed ? "pointer-events-none opacity-30" : ""}`}
            style={{ "--level-accent": visual.accent } as CSSProperties}
            onMouseEnter={() => {
              if (!compact) activate(index);
            }}
          >
            <button
              type="button"
              className="level-accordion-trigger"
              onClick={() => handlePanelAction(index)}
              onFocus={() => activate(index)}
              onKeyDown={(event) => handleKeyDown(index, event)}
              disabled={item.unlocking || item.dimmed}
              aria-label={`${t("session.levelNumber", {
                level: item.levelNumber,
                defaultValue: "LEVEL {{level}}",
              })}: ${text(item.world.name)} — ${statusLabel}`}
            >
              <span
                ref={(element) => {
                  mediaRefs.current[index] = element;
                }}
                className="level-accordion-media"
              >
                <img
                  src={visual.image}
                  alt=""
                  aria-hidden="true"
                  width={3840}
                  height={2160}
                  loading="eager"
                  fetchPriority={active ? "high" : "auto"}
                  decoding="async"
                  draggable={false}
                />
              </span>
              <span className="level-accordion-wash" aria-hidden="true" />
              <span className="level-accordion-index" aria-hidden="true">
                {String(item.levelNumber).padStart(2, "0")}
              </span>

              <span className="level-accordion-topline">
                <span className="level-accordion-level">
                  {t("session.levelNumber", {
                    level: item.levelNumber,
                    defaultValue: "LEVEL {{level}}",
                  })}
                </span>
                <span
                  className="level-accordion-status"
                  data-state={statusLabel}
                >
                  {item.completed ? (
                    <Check aria-hidden="true" />
                  ) : item.locked || item.unlocking ? (
                    <LockKeyhole aria-hidden="true" />
                  ) : null}
                  {statusLabel}
                </span>
              </span>

              <span
                ref={(element) => {
                  contentRefs.current[index] = element;
                }}
                className="level-accordion-content"
              >
                <span className="level-accordion-title">
                  {active ? (
                    <ShinyText speed={5} shineColor="rgba(255, 255, 255, 0.85)">
                      {text(item.world.name)}
                    </ShinyText>
                  ) : (
                    text(item.world.name)
                  )}
                </span>
                <span className="level-accordion-description">
                  {text(item.world.description)}
                </span>
                <span className="level-accordion-enter">
                  {item.unlocking
                    ? t("session.levelUnlocking", "Unlocking")
                    : item.locked
                      ? (item.lockLabel ?? t("session.levelLocked", "Locked"))
                      : item.completed
                        ? t("session.levelReplay", "Play again")
                        : t("session.enter", "Enter")}
                  {available ? (
                    <ArrowRight aria-hidden="true" />
                  ) : (
                    <LockKeyhole aria-hidden="true" />
                  )}
                </span>
              </span>
            </button>

            {active && (
              <div className="level-accordion-tools">
                <button
                  type="button"
                  onClick={(event) => onViewDetails(event, item.world.id)}
                  aria-label={t("world.viewDetails", "View details")}
                >
                  <Eye aria-hidden="true" />
                </button>
                {item.world.metadata?.source !== "file" && (
                  <button
                    type="button"
                    onClick={(event) => onDelete(event, item.world.id)}
                    aria-label={t("world.delete", "Delete world")}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
