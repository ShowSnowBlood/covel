import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

export interface TrueFocusProps extends React.HTMLAttributes<HTMLDivElement> {
  sentence: string;
  manualMode?: boolean;
  blurAmount?: number;
  borderColor?: string;
  glowColor?: string;
  animationDuration?: number;
  pauseBetweenAnimations?: number;
  className?: string;
}

interface FocusRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * TrueFocus — React Bits (https://reactbits.dev/text-animations/true-focus)
 * Focus bounding box that smoothly glides between words with corner accents.
 */
export function TrueFocus({
  sentence,
  manualMode = false,
  blurAmount = 4,
  borderColor = "var(--color-primary)",
  glowColor = "rgba(255, 255, 255, 0.2)",
  animationDuration = 0.5,
  pauseBetweenAnimations = 1,
  className = "",
  ...props
}: TrueFocusProps) {
  const words = sentence.split(" ");
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [lastActiveIndex, setLastActiveIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [focusRect, setFocusRect] = useState<FocusRect>({ x: 0, y: 0, width: 0, height: 0 });

  useEffect(() => {
    if (manualMode) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % words.length);
    }, (animationDuration + pauseBetweenAnimations) * 1000);

    return () => {
      clearInterval(interval);
    };
  }, [manualMode, animationDuration, pauseBetweenAnimations, words.length]);

  useEffect(() => {
    const activeIndex = manualMode && lastActiveIndex !== null ? lastActiveIndex : currentIndex;
    const targetWord = wordRefs.current[activeIndex];
    const container = containerRef.current;

    if (targetWord && container) {
      const parentRect = container.getBoundingClientRect();
      const wordRect = targetWord.getBoundingClientRect();

      setFocusRect({
        x: wordRect.left - parentRect.left,
        y: wordRect.top - parentRect.top,
        width: wordRect.width,
        height: wordRect.height,
      });
    }
  }, [currentIndex, lastActiveIndex, manualMode]);

  return (
    <div
      ref={containerRef}
      className={cn("relative inline-flex flex-wrap items-center gap-x-2 gap-y-1 p-2", className)}
      {...props}
    >
      {words.map((word, index) => {
        const isActive = index === (manualMode && lastActiveIndex !== null ? lastActiveIndex : currentIndex);
        return (
          <span
            key={index}
            ref={(el) => {
              wordRefs.current[index] = el;
            }}
            onMouseEnter={() => manualMode && setLastActiveIndex(index)}
            onMouseLeave={() => manualMode && setLastActiveIndex(null)}
            className={cn(
              "cursor-pointer select-none transition-all duration-300 font-medium",
              isActive
                ? "opacity-100 filter-none"
                : "opacity-45 hover:opacity-75",
            )}
            style={{
              filter: isActive ? "none" : `blur(${blurAmount}px)`,
            }}
          >
            {word}
          </span>
        );
      })}

      {/* Floating Focus Frame */}
      <div
        className="pointer-events-none absolute transition-all duration-500 ease-out"
        style={{
          transform: `translate3d(${focusRect.x - 4}px, ${focusRect.y - 2}px, 0)`,
          width: `${focusRect.width + 8}px`,
          height: `${focusRect.height + 4}px`,
          border: `1.5px solid ${borderColor}`,
          borderRadius: "0.5rem",
          boxShadow: `0 0 16px ${glowColor}`,
        }}
      >
        <span
          className="absolute -top-[3px] -left-[3px] h-2 w-2 rounded-tl-sm"
          style={{ borderTop: `2px solid ${borderColor}`, borderLeft: `2px solid ${borderColor}` }}
        />
        <span
          className="absolute -top-[3px] -right-[3px] h-2 w-2 rounded-tr-sm"
          style={{ borderTop: `2px solid ${borderColor}`, borderRight: `2px solid ${borderColor}` }}
        />
        <span
          className="absolute -bottom-[3px] -left-[3px] h-2 w-2 rounded-bl-sm"
          style={{ borderBottom: `2px solid ${borderColor}`, borderLeft: `2px solid ${borderColor}` }}
        />
        <span
          className="absolute -bottom-[3px] -right-[3px] h-2 w-2 rounded-br-sm"
          style={{ borderBottom: `2px solid ${borderColor}`, borderRight: `2px solid ${borderColor}` }}
        />
      </div>
    </div>
  );
}
