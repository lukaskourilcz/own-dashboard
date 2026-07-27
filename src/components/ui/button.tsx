import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-semibold transition-[background,color,border-color,filter] duration-150 ease-out focus-ring disabled:pointer-events-none disabled:opacity-40 [&>svg]:shrink-0 [&>svg]:size-4",
  {
    variants: {
      variant: {
        default:
          "mac-primary-button border border-primary/60 text-primary-foreground shadow-soft hover:brightness-105",
        outline:
          "border border-border bg-surface text-foreground hover:bg-surface-hover hover:border-border-strong",
        ghost:
          "text-foreground-muted hover:text-foreground hover:bg-surface-hover",
        subtle:
          "bg-accent text-accent-foreground hover:bg-surface-hover",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90",
        link:
          "text-foreground underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-3.5 md:h-8",
        sm: "h-9 px-3 text-xs md:h-7",
        lg: "h-11 px-5 text-sm md:h-10",
        icon: "h-10 w-10 md:h-9 md:w-9",
        "icon-sm": "h-7 w-7",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
