import * as React from "react";
import { Button } from "@/components/ui/button";

type Option = { label: React.ReactNode; value: string };

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size,
}: {
  value: T;
  options: Array<Omit<Option, "value"> & { value: T }>;
  onChange?: (v: T) => void;
  size?: "small" | "middle" | "large" | string;
}) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {options.map((op) => (
        <Button
          key={String(op.value)}
          variant={value === op.value ? "default" : "outline"}
          size={size === "large" ? "lg" : "sm"}
          onClick={() => onChange?.(op.value)}
        >
          {op.label}
        </Button>
      ))}
    </div>
  );
}
