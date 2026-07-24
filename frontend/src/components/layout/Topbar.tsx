import { ReactNode } from "react";

type TopbarProps = {
  left: ReactNode;
  right: ReactNode;
};

export function Topbar({ left, right }: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-card-border bg-white/80 backdrop-blur-xl">
      <div className="flex h-16 w-full items-center justify-between px-8">
        <div className="flex min-w-0 items-center gap-4">
          {left}
        </div>
        <div className="flex items-center gap-3">
          {right}
        </div>
      </div>
    </header>
  );
}