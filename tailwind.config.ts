/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        kibt: {
          green: "#1a6b3c",
          "green-light": "#2d9b5a",
          "green-dark": "#0f4526",
          gold: "#c9a227",
          "gold-light": "#e8c052",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
