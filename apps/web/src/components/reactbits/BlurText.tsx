import React from "react";
import { cn } from "@/lib/utils";

export interface BlurTextProps extends React.HTMLAttributes<HTMLParagraphElement> {
  text: string;
  delay?: number;
  className?: string;
  animateBy?: "words" | "letters";
  direction?: "top" | "bottom";
}

/**
 * BlurText — React Bits (https://reactbits.dev/text-animations/blur-text)
 * Staggered word or letter blur-in editorial animation.
 */
export function BlurText({
  text,
  delay = 50,
  className = "",
  animateBy = "words",
  direction = "top",
  ...props
}: BlurTextProps) {
  const elements = animateBy === "words" ? text.split(" ") : text.split("");

  return (
    <p className={cn("inline-flex flex-wrap gap-x-1.5", className)} {...props}>
      {elements.map((element, index) => (
        <span
          key={index}
          className="inline-block animate-[blur-text-reveal_0.6s_cubic-bezier(0.2,0.8,0.2,1)_both]"
          style={{
            animationDelay: `${index * delay}ms`,
            transform: direction === "top" ? "translateY(8px)" : "translateY(-8px)",
          }}
        >
          {element === " " ? "\u00A0" : element}
        </span>
      ))}
    </p>
  );
}
