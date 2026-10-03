import type { Config } from "tailwindcss";

// Types the default import in a TypeScript tailwind.config. At runtime the color leaves are
// Tailwind color functions ({ opacityValue }) => string, which Tailwind 3.4 accepts but its
// published types describe only as strings.
declare const sleeveTheme: NonNullable<NonNullable<Config["theme"]>["extend"]>;

export = sleeveTheme;
