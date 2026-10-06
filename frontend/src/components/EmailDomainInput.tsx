import { useEffect, useRef, useState } from "react";
import { ALLOWED_EMAIL_DOMAINS } from "../lib/emailDomains";

/**
 * A plain email <input> that, once the person types "name@" (optionally
 * followed by a few characters of a domain), drops down the list of
 * allowed domains so they can pick one instead of typing it out — mirrors
 * ALLOWED_EMAIL_DOMAINS in lib/emailDomains.ts / the backend's
 * lib/password.ts, so the choices always match what the invite will
 * actually accept.
 */
export function EmailDomainInput({
  value,
  onChange,
  onBlur,
  placeholder = "person@example.com",
  className = "input",
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const atIndex = value.indexOf("@");
  const localPart = atIndex === -1 ? value : value.slice(0, atIndex);
  const domainTyped = atIndex === -1 ? "" : value.slice(atIndex + 1);

  // Only worth suggesting once there's something to attach a domain to,
  // and only while the domain segment itself has no "@" of its own (i.e.
  // exactly one "@" in the value so far).
  const canSuggest = atIndex !== -1 && !!localPart && !domainTyped.includes("@");

  const suggestions = canSuggest
    ? ALLOWED_EMAIL_DOMAINS.filter((d) => d.toLowerCase().startsWith(domainTyped.toLowerCase()))
    : [];

  const showMenu = open && canSuggest && suggestions.length > 0;

  useEffect(() => {
    setHighlight(0);
  }, [domainTyped, open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc, true);
    return () => document.removeEventListener("mousedown", onDoc, true);
  }, [open]);

  function pick(domain: string) {
    onChange(`${localPart}@${domain}`);
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showMenu) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" && suggestions[highlight]) {
      e.preventDefault();
      pick(suggestions[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <input
        ref={inputRef}
        className={className}
        type="email"
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        autoComplete="off"
        role="combobox"
        aria-expanded={showMenu}
        aria-autocomplete="list"
      />
      {showMenu && (
        <div className="dd-menu absolute z-30 mt-1 min-w-full left-0">
          {suggestions.map((domain, i) => (
            <button
              key={domain}
              type="button"
              // mousedown (not click) fires before the input's blur, so the
              // pick registers before onBlur would otherwise close the menu.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(domain);
              }}
              className={`dd-option ${i === highlight ? "selected" : ""}`}
            >
              {localPart}@{domain}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}