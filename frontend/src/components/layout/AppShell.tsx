import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

/*
  Per-section background images.
  To use a different image for a section, add the file to public/
  and update the `image` path here.
*/
const PAGE_BG: Record<string, { image: string; opacity: number; blur: number }> = {
  "/":            { image: "/backgroundimage8.jpeg",  opacity: 0.15, blur: 10 },
  "/projects":    { image: "/backgroundimage7.jpeg",  opacity: 0.15,  blur: 10 },
  "/profile":     { image: "/backgroundimage4.jpeg",  opacity: 0.15,  blur: 5},
  "/members":     { image: "/backgroundimage1.jpeg",  opacity: 0.15,  blur: 5 },
  "/org-settings":{ image: "/backgroundimage6.jpeg",  opacity: 0.15,  blur: 5 },
  "/tickets":     { image: "/backgroundimage1.jpeg",  opacity: 0.15, blur: 5 },
  "/my-work":     { image: "/backgroundimage7.jpeg",  opacity: 0.15, blur: 10 },
};

const DEFAULT_BG = { image: "/backgroundimage.jpeg", opacity: 0.04, blur: 1.5 };

function getBg(pathname: string) {
  // exact match first, then prefix match (/projects/xyz → /projects)
  if (PAGE_BG[pathname]) return PAGE_BG[pathname];
  const prefix = Object.keys(PAGE_BG).find((k) => k !== "/" && pathname.startsWith(k));
  return prefix ? PAGE_BG[prefix] : DEFAULT_BG;
}

type Props = {
  admin: boolean;
  developer: boolean;
  topbarLeft: ReactNode;
  topbarRight: ReactNode;
  children: ReactNode;
};

export function AppShell({ admin, developer, topbarLeft, topbarRight, children }: Props) {
  const { pathname } = useLocation();
  const bg = getBg(pathname);

  return (
    <div className="flex min-h-screen">
      <Sidebar admin={admin} developer={developer} />

      <div className="relative flex min-h-screen flex-1 flex-col overflow-hidden bg-bg">
        {/* Section-specific background image */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: `url(${bg.image})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            opacity: bg.opacity,
            filter: `blur(${bg.blur}px) saturate(0.6)`,
          }}
        />

        <Topbar left={topbarLeft} right={topbarRight} />

        <main className="relative z-10 mx-auto w-full max-w-[1600px] flex-1 px-8 py-8">
          {children}
        </main>
      </div>
    </div>
  );
}