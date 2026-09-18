import * as React from "react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";
export function Button({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & {
  variant?: "default" | "ghost" | "outline";
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        variant === "default"
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "hover:bg-accent",
        className,
      )}
      {...props}
    />
  );
}
