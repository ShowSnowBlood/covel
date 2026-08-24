import React, { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface MagnetProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  padding?: number;
  disabled?: boolean;
  magnetStrength?: number;
  activeTransition?: string;
  inactiveTransition?: string;
  className?: string;
}

/**
 * Magnet — React Bits (https://reactbits.dev/animations/magnet)
 * Interactive magnetic pull on elements when cursor moves nearby.
 */
export function Magnet({
  children,
  padding = 100,
  disabled = false,
  magnetStrength = 2,
  activeTransition = "transform 0.2s ease-out",
  inactiveTransition = "transform 0.5s ease-in-out",
  className = "",
  ...props
}: MagnetProps) {
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const magnetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (disabled) {
      setPosition({ x: 0, y: 0 });
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!magnetRef.current) return;
      const { left, top, width, height } = magnetRef.current.getBoundingClientRect();
      const centerX = left + width / 2;
      const centerY = top + height / 2;

      const distX = Math.abs(centerX - e.clientX);
      const distY = Math.abs(centerY - e.clientY);

      if (distX < width / 2 + padding && distY < height / 2 + padding) {
        setPosition({
          x: (e.clientX - centerX) / magnetStrength,
          y: (e.clientY - centerY) / magnetStrength,
        });
      } else {
        setPosition({ x: 0, y: 0 });
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, [padding, disabled, magnetStrength]);

  const isAttracted = position.x !== 0 || position.y !== 0;

  return (
    <div
      ref={magnetRef}
      className={cn("inline-block", className)}
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        transition: isAttracted ? activeTransition : inactiveTransition,
        willChange: "transform",
      }}
      {...props}
    >
      {children}
    </div>
  );
}
