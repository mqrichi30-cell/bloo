import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          900: "#0B0E30",
        },
        slate: {
          800: "#262A33",
        },
        blue: {
          300: "#80A7B6",
        },
        cream: {
          100: "#E5E1D0",
        },
        warmgray: {
          500: "#84817D",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          alt: "#F5F6F7",
        },
        line: {
          200: "#E4E4E2",
        },
        ink: {
          900: "#1A1D24",
          600: "#55585F",
        },
        success: {
          text: "#2E6B54",
          bg: "#E4F0EA",
        },
        warn: {
          text: "#8A6A2C",
          bg: "#F4EBD8",
        },
        error: {
          text: "#9E3B2E",
          bg: "#F5E4E0",
        },
        info: {
          text: "#3E6B7D",
          bg: "#E6EEF1",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "Helvetica Now Text",
          "Helvetica Neue",
          "Helvetica",
          "Arial",
          "system-ui",
          "sans-serif",
        ],
        script: ["var(--font-script)", "Dancing Script", "cursive"],
      },
      fontSize: {
        display: ["2.5rem", { lineHeight: "1.1" }],
        h1: ["1.5rem", { lineHeight: "1.25", fontWeight: "600" }],
        h2: ["1.125rem", { lineHeight: "1.3", fontWeight: "600" }],
        body: ["0.9375rem", { lineHeight: "1.5" }],
        label: ["0.8125rem", { lineHeight: "1.3", fontWeight: "500" }],
        caption: ["0.75rem", { lineHeight: "1.3" }],
        "data-lg": ["1.75rem", { lineHeight: "1.2", fontWeight: "700" }],
        "data-md": ["0.9375rem", { lineHeight: "1.3", fontWeight: "600" }],
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "20px",
      },
      boxShadow: {
        sm: "0 1px 2px rgba(11,14,48,.06)",
        md: "0 4px 12px rgba(11,14,48,.10)",
        lg: "0 12px 32px rgba(11,14,48,.16)",
      },
      spacing: {
        18: "4.5rem",
      },
      zIndex: {
        dropdown: "1000",
        sticky: "1100",
        "modal-backdrop": "1200",
        modal: "1300",
        toast: "1400",
        tooltip: "1500",
      },
      keyframes: {
        "wave-draw": {
          "0%": { strokeDashoffset: "48" },
          "100%": { strokeDashoffset: "0" },
        },
        "check-draw": {
          "0%": { strokeDashoffset: "24" },
          "100%": { strokeDashoffset: "0" },
        },
        "sheet-up": {
          "0%": { transform: "translateY(100%)" },
          "100%": { transform: "translateY(0)" },
        },
        "toast-in": {
          "0%": { transform: "translateY(12px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        "wave-draw": "wave-draw .8s ease-out forwards",
        "check-draw": "check-draw .35s ease-out forwards",
        "sheet-up": "sheet-up .25s cubic-bezier(0.16,1,0.3,1) forwards",
        "toast-in": "toast-in .25s cubic-bezier(0.16,1,0.3,1) forwards",
      },
    },
  },
  plugins: [],
};
export default config;
