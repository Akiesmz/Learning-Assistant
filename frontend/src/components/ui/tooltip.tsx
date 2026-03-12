import * as React from "react";

export function Tooltip({
  title,
  children,
}: {
  title?: React.ReactNode;
  children: React.ReactNode;
}) {
  return <span title={String(title ?? "")}>{children}</span>;
}

