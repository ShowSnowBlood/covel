import React from "react";
import { cn } from "@/lib/utils";

export interface StarBorderProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: React.ElementType;
  className?: string;
  color?: string;
  speed?: string;
  children?: React.ReactNode;
}

/**
 * StarBorder — React Bits (https://reactbits.dev/animations/star-border)
 * Continuous revolving gradient star border around containers.
 */
export function StarBorder({
  as: Component = "div",
  className = "",
  color = "oklch(96% 0.004 260)",
  speed = "6s",
  children,
  ...props
}: StarBorderProps) {
  return (
    <Component
      className={cn(
        "relative inline-block overflow-hidden rounded-xl p-[1px]",
        className,
      )}
      {...props}
    >
      <div
        className="absolute inset-[-100%] animate-[star-border-spin_linear_infinite]"
        style={{
          animationDuration: speed,
          background: `conic-gradient(from 0deg, transparent 0 340deg, ${color} 360deg)`,
        }}
        aria-hidden="true"
      />
      <div className="relative z-10 h-full w-full rounded-[inherit] bg-card/90 backdrop-blur-md">
        {children}
      </div>
    </Component>
  );
}
