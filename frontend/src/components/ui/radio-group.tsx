import * as React from "react";
import { cn } from "@/lib/utils";

type RadioOption = {
  label: React.ReactNode;
  value: string;
};

export function RadioGroup({
  value,
  options,
  onValueChange,
  className,
}: {
  value?: string;
  options: RadioOption[];
  onValueChange?: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {options.map((op) => {
        const active = value === op.value;
        return (
          <button
            key={op.value}
            type="button"
            onClick={() => onValueChange?.(op.value)}
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-left",
              active ? "border-primary bg-primary/10" : "border-border bg-background"
            )}
          >
            <span className={cn("inline-block h-3.5 w-3.5 rounded-full border", active ? "border-primary" : "border-muted-foreground")}>
              <span className={cn("block h-2 w-2 rounded-full m-[2px]", active ? "bg-primary" : "bg-transparent")} />
            </span>
            <span>{op.label}</span>
          </button>
        );
      })}
    </div>
  );
}

