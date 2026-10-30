import type { ReactNode } from "react";
export function Loading({ children }: { children: ReactNode }) {
  return (
    <div className="loading-state" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
