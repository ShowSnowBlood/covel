import React from "react";
import { cn } from "@/lib/utils";

export interface ShinyTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
  disabled?: boolean;
  speed?: number; // duration in seconds
  className?: string;
  shineColor?: string;
}

/**
 * ShinyText — React Bits (https://reactbits.dev/text-animations/shiny-text)
 * Metallic light shine sweeping across text.
 */
export function ShinyText({
  children,
  disabled = false,
  speed = 4,
  className = "",
  shineColor = "rgba(255, 255, 255, 0.8)",
  style,
  ...props
}: ShinyTextProps) {
  if (disabled) {
    return (
      <span className={className} style={style} {...props}>
        {children}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-block bg-clip-text text-transparent bg-[length:200%_100%] transition-all",
        className,
      )}
      style={{
        backgroundImage: `linear-gradient(120deg, currentColor 0%, currentColor 38%, ${shineColor} 50%, currentColor 62%, currentColor 100%)`,
        animation: `shiny-text-sweep ${speed}s linear infinite`,
        ...style,
      }}
      {...props}
    >
      {children}
    </span>
  );
}
