import { useEffect, useRef, useState } from "react";

export function AccountMenu({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    const navigate = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("hashchange", navigate);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("hashchange", navigate);
    };
  }, [open]);
  return (
    <div className="account-actions" ref={container}>
      <button ref={trigger} type="button" className="secondary account-trigger" aria-expanded={open} aria-controls="account-dropdown" onClick={() => setOpen(!open)}>
        My Account <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <nav id="account-dropdown" className="account-dropdown" aria-label="Account options">
          <a href="#/settings" onClick={() => setOpen(false)}>Settings</a>
          <button type="button" disabled={busy} onClick={async () => {
            setBusy(true); setError("");
            try { await onSignOut(); setOpen(false); }
            catch (error) { setError(error instanceof Error ? error.message : "Unable to sign out. Please try again."); }
            finally { setBusy(false); }
          }}>{busy ? "Signing out…" : "Sign out"}</button>
          {error && <p role="alert">{error}</p>}
        </nav>
      )}
    </div>
  );
}
