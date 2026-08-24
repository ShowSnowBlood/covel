import React, { useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface TiltedCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  maxAngle?: number;
  scale?: number;
  glareOpacity?: number;
  className?: string;
}

/**
 * TiltedCard — React Bits (https://reactbits.dev/components/tilted-card)
 * 3D perspective tilt hover card with subtle specular glare.
 */
export function TiltedCard({
  children,
  maxAngle = 12,
  scale = 1.02,
  glareOpacity = 0.15,
  className = "",
  onMouseMove,
  onMouseLeave,
  ...props
}: TiltedCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [rotateX, setRotateX] = useState<number>(0);
  const [rotateY, setRotateY] = useState<number>(0);
  const [glarePosition, setGlarePosition] = useState<{ x: number; y: number }>({ x: 50, y: 50 });
  const [isHovered, setIsHovered] = useState<boolean>(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rX = ((y - centerY) / centerY) * -maxAngle;
    const rY = ((x - centerX) / centerX) * maxAngle;

    setRotateX(rX);
    setRotateY(rY);
    setGlarePosition({
      x: (x / rect.width) * 100,
      y: (y / rect.height) * 100,
    });
    setIsHovered(true);
    onMouseMove?.(e);
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    setRotateX(0);
    setRotateY(0);
    setIsHovered(false);
    onMouseLeave?.(e);
  };

  return (
    <div
      style={{ perspective: "1000px" }}
      className="inline-block w-full"
    >
      <div
        ref={cardRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className={cn(
          "relative overflow-hidden rounded-xl transition-transform duration-200 ease-out will-change-transform",
          className,
        )}
        style={{
          transform: isHovered
            ? `rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${scale})`
            : "rotateX(0deg) rotateY(0deg) scale(1)",
          transformStyle: "preserve-3d",
        }}
        {...props}
      >
        {children}

        {/* Specular light glare overlay */}
        <div
          className="pointer-events-none absolute inset-0 transition-opacity duration-300"
          style={{
            opacity: isHovered ? glareOpacity : 0,
            background: `radial-gradient(circle at ${glarePosition.x}% ${glarePosition.y}%, rgba(255,255,255,0.8), transparent 60%)`,
          }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
