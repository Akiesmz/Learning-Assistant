import * as React from "react";
import { Button } from "@/components/ui/button";

export function Drawer({
  open,
  onClose,
  title,
  children,
  panelClassName,
  contentClassName,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  panelClassName?: string;
  contentClassName?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[2100] bg-black/35 flex justify-end" onClick={onClose}>
      <div
        className={`h-full w-full max-w-[760px] bg-background border-l border-border overflow-y-auto ${panelClassName || ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>{title}</div>
          <Button size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
        <div className={`p-4 ${contentClassName || ""}`}>{children}</div>
      </div>
    </div>
  );
}
