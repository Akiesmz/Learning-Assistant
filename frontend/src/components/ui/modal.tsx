import * as React from "react";
import { Button } from "@/components/ui/button";

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidthClassName = "max-w-[640px]",
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidthClassName?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[2100] bg-black/20 backdrop-blur-sm flex items-center justify-center p-4 transition-all duration-300 animate-in fade-in" onClick={onClose}>
      <div
        className={`w-full ${maxWidthClassName} rounded-2xl border border-white/20 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md shadow-2xl max-h-[85vh] overflow-y-auto animate-in zoom-in-95 duration-300`}
        onClick={(e) => e.stopPropagation()}
      >
        {title ? (
          <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3">
            <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</div>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400">
              <span className="text-xl leading-none">&times;</span>
            </Button>
          </div>
        ) : null}
        <div className="p-6 text-gray-900 dark:text-gray-100">{children}</div>
        {footer ? <div className="px-6 pb-6 pt-0">{footer}</div> : null}
      </div>
    </div>
  );
}

