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
      },
    },
    // Magpie principle: sharp corners everywhere + no drop shadows.
    borderRadius: {
      none: "0", sm: "0", DEFAULT: "0", md: "0", lg: "0", xl: "0",
      "2xl": "0", "3xl": "0", full: "0",
    },
    boxShadow: {
      none: "none", sm: "none", DEFAULT: "none", md: "none", lg: "none",
      xl: "none", "2xl": "none", inner: "none",
    },
  },
  plugins: [],
};
