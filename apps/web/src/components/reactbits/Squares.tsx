import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface SquaresProps extends React.HTMLAttributes<HTMLCanvasElement> {
  direction?: "diagonal" | "up" | "right" | "down" | "left";
  speed?: number;
  borderColor?: string;
  squareSize?: number;
  hoverFillColor?: string;
  className?: string;
}

/**
 * Squares — React Bits (https://reactbits.dev/backgrounds/squares)
 * Animated interactive moving grid squares background.
 */
export function Squares({
  direction = "right",
  speed = 0.5,
  borderColor = "rgba(255, 255, 255, 0.08)",
  squareSize = 40,
  hoverFillColor = "rgba(255, 255, 255, 0.05)",
  className = "",
  ...props
}: SquaresProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gridOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const hoveredSquare = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };

    resize();
    window.addEventListener("resize", resize);

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const startX = Math.floor((x - (gridOffset.current.x % squareSize)) / squareSize);
      const startY = Math.floor((y - (gridOffset.current.y % squareSize)) / squareSize);

      hoveredSquare.current = { x: startX, y: startY };
    };

    const handleMouseLeave = () => {
      hoveredSquare.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseleave", handleMouseLeave);

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (direction === "right") gridOffset.current.x += speed;
      if (direction === "left") gridOffset.current.x -= speed;
      if (direction === "up") gridOffset.current.y -= speed;
      if (direction === "down") gridOffset.current.y += speed;
      if (direction === "diagonal") {
        gridOffset.current.x += speed;
        gridOffset.current.y += speed;
      }

      const offsetX = gridOffset.current.x % squareSize;
      const offsetY = gridOffset.current.y % squareSize;

      const numCols = Math.ceil(canvas.width / squareSize) + 2;
      const numRows = Math.ceil(canvas.height / squareSize) + 2;

      for (let i = -1; i < numCols; i++) {
        for (let j = -1; j < numRows; j++) {
          const sqX = i * squareSize + offsetX;
          const sqY = j * squareSize + offsetY;

          if (
            hoveredSquare.current &&
            hoveredSquare.current.x === i &&
            hoveredSquare.current.y === j
          ) {
            ctx.fillStyle = hoverFillColor;
            ctx.fillRect(sqX, sqY, squareSize, squareSize);
          }

          ctx.strokeStyle = borderColor;
          ctx.strokeRect(sqX, sqY, squareSize, squareSize);
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
      cancelAnimationFrame(animationFrameId);
    };
  }, [direction, speed, borderColor, squareSize, hoverFillColor]);

  return (
    <canvas
      ref={canvasRef}
      className={cn("pointer-events-none absolute inset-0 h-full w-full", className)}
      aria-hidden="true"
      {...props}
    />
  );
}
