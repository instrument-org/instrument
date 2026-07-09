// Tailwind class ordering and linting now run via oxlint-tailwindcss (each
// consuming package's .oxlintrc.json), which is far faster than the ESLint
// plugin and shares one class order with the formatter. This config is now
// just the React config; the export is kept so consumers need not change their
// import path.
export { default } from "./react";
