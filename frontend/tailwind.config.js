/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        accent: "var(--accent)",
        fg: "var(--fg)",
        "fg-soft": "var(--fg-soft)",
        muted: "var(--muted)",
        line: "var(--line)",
        "card-border": "var(--card-border)",
        ok: "var(--ok)",
        warn: "var(--warn)",
        danger: "var(--danger)",
        primary: "var(--primary)",
        "primary-hover": "var(--primary-hover)",
        "sidebar-bg": "var(--sidebar-bg)",
        "sidebar-fg": "var(--sidebar-fg)",
        "sidebar-muted": "var(--sidebar-muted)",
        "sidebar-active": "var(--sidebar-active)",
      },
      borderRadius: {
        xs: "6px",
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
        elevated: "0 4px 14px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)",
        dropdown: "0 10px 40px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)",
      },
    },
  },
  plugins: [],
};