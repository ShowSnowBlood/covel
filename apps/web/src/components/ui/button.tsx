import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * HeroUI Button Variants
 * Designed with HeroUI / NextUI visual language:
 * - Rounded radii with active press scale feedback (active:scale-[0.97])
 * - Distinct variants: solid, bordered, light, flat, faded, shadow, ghost
 * - Multiple semantic colors: default, primary, secondary, success, warning, danger
 * - Dynamic cursor-origin ripple animation
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap outline-none select-none transition-all duration-200 ease-out transform-gpu active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 disabled:scale-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring/50 focus-visible:ring-offset-background [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 relative overflow-hidden",
  {
    variants: {
      variant: {
        // HeroUI standard variants
        solid: "border-transparent",
        bordered: "border bg-transparent",
        light: "border-transparent bg-transparent",
        flat: "border-transparent",
        faded: "border",
        shadow: "border-transparent shadow-md",
        ghost: "border bg-transparent",
        link: "border-transparent bg-transparent underline-offset-4 hover:underline active:scale-100",

        // Backward-compatible shadcn aliases
        default: "border-transparent bg-primary text-primary-foreground hover:opacity-90 shadow-xs active:opacity-100",
        destructive: "border-transparent bg-destructive text-white hover:opacity-90 shadow-xs",
        outline: "border border-input bg-background/60 backdrop-blur-xs text-foreground hover:bg-accent hover:text-accent-foreground shadow-xs",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        // Note: ghost is also defined in HeroUI standard variants
      },
      color: {
        default: "",
        primary: "",
        secondary: "",
        success: "",
        warning: "",
        danger: "",
      },
      radius: {
        none: "rounded-none",
        sm: "rounded-md",
        md: "rounded-lg",
        lg: "rounded-xl",
        full: "rounded-full",
      },
      size: {
        default: "h-9 px-4 py-2 text-sm gap-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-xs has-[>svg]:px-2.5",
        md: "h-9 px-4 py-2 text-sm gap-2 has-[>svg]:px-3",
        lg: "h-11 px-6 text-base gap-2.5 has-[>svg]:px-4",
        xl: "h-13 px-8 text-lg gap-3 has-[>svg]:px-5",
        icon: "size-9 rounded-lg",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-lg",
        "icon-lg": "size-11 rounded-xl",
      },
    },
    compoundVariants: [
      // Solid variants
      {
        variant: "solid",
        color: "default",
        className: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      },
      {
        variant: "solid",
        color: "primary",
        className: "bg-primary text-primary-foreground hover:opacity-90 shadow-sm",
      },
      {
        variant: "solid",
        color: "secondary",
        className: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      },
      {
        variant: "solid",
        color: "success",
        className: "bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm shadow-emerald-500/20",
      },
      {
        variant: "solid",
        color: "warning",
        className: "bg-amber-500 text-amber-950 font-semibold hover:bg-amber-400 shadow-sm shadow-amber-500/20",
      },
      {
        variant: "solid",
        color: "danger",
        className: "bg-destructive text-white hover:bg-destructive/90 shadow-sm shadow-destructive/20",
      },

      // Bordered variants
      {
        variant: "bordered",
        color: "default",
        className: "border-border text-foreground hover:bg-accent/40 hover:border-foreground/30",
      },
      {
        variant: "bordered",
        color: "primary",
        className: "border-primary/60 text-primary hover:bg-primary/10 hover:border-primary",
      },
      {
        variant: "bordered",
        color: "secondary",
        className: "border-secondary-foreground/30 text-secondary-foreground hover:bg-secondary/40",
      },
      {
        variant: "bordered",
        color: "success",
        className: "border-emerald-500/60 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10",
      },
      {
        variant: "bordered",
        color: "warning",
        className: "border-amber-500/60 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10",
      },
      {
        variant: "bordered",
        color: "danger",
        className: "border-destructive/60 text-destructive hover:bg-destructive/10 hover:border-destructive",
      },

      // Light / Ghost variants
      {
        variant: "light",
        color: "default",
        className: "text-foreground hover:bg-accent/60",
      },
      {
        variant: "light",
        color: "primary",
        className: "text-primary hover:bg-primary/10",
      },
      {
        variant: "light",
        color: "danger",
        className: "text-destructive hover:bg-destructive/10",
      },
      {
        variant: "ghost",
        color: "default",
        className: "border-transparent text-foreground hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
      },
      {
        variant: "ghost",
        color: "primary",
        className: "border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground",
      },
      {
        variant: "ghost",
        color: "danger",
        className: "border-destructive/40 text-destructive hover:bg-destructive hover:text-white",
      },

      // Flat variants (HeroUI soft tint style)
      {
        variant: "flat",
        color: "default",
        className: "bg-muted/80 text-foreground hover:bg-muted",
      },
      {
        variant: "flat",
        color: "primary",
        className: "bg-primary/12 text-primary hover:bg-primary/20",
      },
      {
        variant: "flat",
        color: "secondary",
        className: "bg-secondary/60 text-secondary-foreground hover:bg-secondary",
      },
      {
        variant: "flat",
        color: "success",
        className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25",
      },
      {
        variant: "flat",
        color: "warning",
        className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25",
      },
      {
        variant: "flat",
        color: "danger",
        className: "bg-destructive/15 text-destructive hover:bg-destructive/25",
      },

      // Shadow variants (HeroUI signature colored glow)
      {
        variant: "shadow",
        color: "default",
        className: "bg-foreground text-background shadow-md shadow-foreground/15 hover:opacity-90",
      },
      {
        variant: "shadow",
        color: "primary",
        className: "bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/35 hover:opacity-95",
      },
      {
        variant: "shadow",
        color: "danger",
        className: "bg-destructive text-white shadow-lg shadow-destructive/30 hover:shadow-xl hover:shadow-destructive/40 hover:opacity-95",
      },
      {
        variant: "shadow",
        color: "success",
        className: "bg-emerald-600 text-white shadow-lg shadow-emerald-600/30 hover:shadow-xl hover:shadow-emerald-600/40 hover:opacity-95",
      },

      // Link variants
      {
        variant: "link",
        color: "default",
        className: "text-foreground",
      },
      {
        variant: "link",
        color: "primary",
        className: "text-primary",
      },
    ],
    defaultVariants: {
      variant: "default",
      color: "default",
      radius: "lg",
      size: "default",
    },
  },
);

interface Ripple {
  x: number;
  y: number;
  size: number;
  key: number;
}

export interface ButtonProps
  extends Omit<React.ComponentProps<"button">, "color">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  isLoading?: boolean;
  disableRipple?: boolean;
  disableAnimation?: boolean;
  startContent?: React.ReactNode;
  endContent?: React.ReactNode;
  spinner?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = "default",
    color = "default",
    radius = "lg",
    size = "default",
    asChild = false,
    isLoading = false,
    disableRipple = false,
    disableAnimation = false,
    startContent,
    endContent,
    spinner,
    onClick,
    children,
    disabled,
    ...props
  },
  ref,
) {
  const [ripples, setRipples] = React.useState<Ripple[]>([]);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  // Merge forwarded ref with local ref for ripple bounding rect
  const handleRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      buttonRef.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        (ref as React.MutableRefObject<HTMLButtonElement | null>).current = node;
      }
    },
    [ref],
  );

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || isLoading) {
      e.preventDefault();
      return;
    }

    if (!disableRipple && !asChild && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const rippleSize = Math.max(rect.width, rect.height) * 2;

      const newRipple: Ripple = {
        x: clickX - rippleSize / 2,
        y: clickY - rippleSize / 2,
        size: rippleSize,
        key: Date.now() + Math.random(),
      };

      setRipples((prev) => [...prev.slice(-3), newRipple]);
    }

    onClick?.(e);
  };

  const handleAnimationEnd = (key: number) => {
    setRipples((prev) => prev.filter((r) => r.key !== key));
  };

  if (asChild) {
    return (
      <Slot
        ref={handleRef}
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={cn(
          buttonVariants({
            variant,
            color,
            radius,
            size,
            className: cn(disableAnimation && "active:scale-100 transition-none", className),
          }),
        )}
        {...props}
      >
        {children}
      </Slot>
    );
  }

  return (
    <button
      ref={handleRef}
      data-slot="button"
      data-variant={variant}
      data-color={color}
      data-size={size}
      disabled={disabled || isLoading}
      onClick={handleClick}
      className={cn(
        buttonVariants({
          variant,
          color,
          radius,
          size,
          className: cn(
            disableAnimation && "active:scale-100 transition-none",
            className,
          ),
        }),
      )}
      {...props}
    >
      {isLoading && (
        <span className="inline-flex shrink-0 animate-spin">
          {spinner ?? <Loader2 className="size-4" />}
        </span>
      )}
      {!isLoading && startContent && (
        <span className="inline-flex shrink-0">{startContent}</span>
      )}
      {children}
      {!isLoading && endContent && (
        <span className="inline-flex shrink-0">{endContent}</span>
      )}
      {/* HeroUI Dynamic Ripple Effect */}
      {!disableRipple &&
        ripples.map((ripple) => (
          <span
            key={ripple.key}
            onAnimationEnd={() => handleAnimationEnd(ripple.key)}
            className="pointer-events-none absolute rounded-full bg-current opacity-20 animate-ping duration-700"
            style={{
              left: `${ripple.x}px`,
              top: `${ripple.y}px`,
              width: `${ripple.size}px`,
              height: `${ripple.size}px`,
            }}
          />
        ))}
    </button>
  );
});

export { Button, buttonVariants };
