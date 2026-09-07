import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees are checkouts of this repo nested inside it, each with
    // its own node_modules and .next. Without this, `bun run lint` walks into
    // their build output and reports errors in bundled chunks — which reads as
    // a regression in this checkout and is nothing of the kind.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
