import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function GlowPanel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border/70 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60",
        className
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(1200px_300px_at_0%_0%,rgba(108,63,245,0.16),transparent),radial-gradient(800px_260px_at_100%_100%,rgba(59,130,246,0.16),transparent)]" />
      <div className="relative">{children}</div>
    </div>
  );
}

export function MetricGlowCard({
  title,
  value,
  suffix,
  className,
}: {
  title: string;
  value: string | number | React.ReactNode;
  suffix?: string;
  className?: string;
}) {
  return (
    <Card className={cn("relative overflow-hidden border-border/70 bg-background/85", className)}>
      <div className="pointer-events-none absolute inset-0 opacity-90 bg-[radial-gradient(320px_120px_at_0%_0%,rgba(108,63,245,0.20),transparent),radial-gradient(280px_120px_at_100%_100%,rgba(59,130,246,0.16),transparent)]" />
      <CardHeader className="relative pb-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="relative">
        <div className="text-2xl font-bold tracking-tight">
          {value}
          {suffix ? <span className="ml-1 text-sm font-normal text-muted-foreground">{suffix}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}

