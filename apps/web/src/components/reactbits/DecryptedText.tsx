import React, { useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";

export interface DecryptedTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  text: string;
  speed?: number;
  maxIterations?: number;
  sequential?: boolean;
  revealDirection?: "start" | "end" | "center";
  useOriginalCharsOnly?: boolean;
  characters?: string;
  className?: string;
  parentClassName?: string;
  animateOn?: "view" | "hover";
}

const DEFAULT_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+~|}{[]:;?><,./-=";

/**
 * DecryptedText — React Bits (https://reactbits.dev/text-animations/decrypted-text)
 * Cyberpunk / sci-fi text decoding animation effect.
 */
export function DecryptedText({
  text,
  speed = 50,
  maxIterations = 10,
  sequential = true,
  characters = DEFAULT_CHARS,
  className = "",
  parentClassName = "",
  animateOn = "view",
  ...props
}: DecryptedTextProps) {
  const [displayText, setDisplayText] = useState<string>(text);
  const [isHovering, setIsHovering] = useState<boolean>(false);
  const [isScrambling, setIsScrambling] = useState<boolean>(false);
  const containerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    let interval: number | undefined;
    let currentIteration = 0;

    const startScramble = () => {
      setIsScrambling(true);
      currentIteration = 0;

      interval = window.setInterval(() => {
        setDisplayText(
          text
            .split("")
            .map((char, index) => {
              if (char === " ") return " ";
              if (sequential) {
                const progress = currentIteration / maxIterations;
                const revealIndex = Math.floor(progress * text.length);
                if (index < revealIndex) {
                  return text[index];
                }
              }
              return characters[Math.floor(Math.random() * characters.length)];
            })
            .join(""),
        );

        currentIteration++;
        if (currentIteration > maxIterations) {
          clearInterval(interval);
          setDisplayText(text);
          setIsScrambling(false);
        }
      }, speed);
    };

    if (animateOn === "view" || (animateOn === "hover" && isHovering)) {
      startScramble();
    } else {
      setDisplayText(text);
    }

    return () => {
      clearInterval(interval);
    };
  }, [text, speed, maxIterations, sequential, characters, animateOn, isHovering]);

  return (
    <span
      ref={containerRef}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      className={cn("inline-block font-mono", parentClassName)}
      {...props}
    >
      <span className={cn(isScrambling && "opacity-90", className)}>
        {displayText}
      </span>
    </span>
  );
}
