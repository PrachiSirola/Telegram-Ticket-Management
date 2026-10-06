import { ReactNode } from "react";
import { IconMenu } from "../Icons";

type TopbarProps = {
  left: ReactNode;
  right: ReactNode;
  onMenuClick?: () => void;
};

export function Topbar({ left, right, onMenuClick }: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-card-border bg-white/80 backdrop-blur-xl">
      <div className="flex min-h-16 w-full flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3 lg:gap-4">
          {onMenuClick && (
            <button
              type="button"
              onClick={onMenuClick}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-fg-soft transition-colors hover:bg-accent lg:hidden"
              aria-label="Open menu"
            >
              <IconMenu size={20} />
            </button>
          )}
          {left}
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {right}
        </div>
      </div>
    </header>
  );
}