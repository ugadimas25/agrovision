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

    // Generated/vendor MapLibre bundles:
    "public/**",

    // Worktree sementara milik agent. Pola ".next/**" di atas berjangkar di
    // akar repo, jadi hasil build DI DALAM worktree (.claude/worktrees/*/.next)
    // tidak ikut terabaikan -- dan eslint melaporkan ratusan galat dari artefak
    // build, bukan dari kode repo ini. Galat yang tidak berasal dari kode kita
    // membuat gerbang "lint 0 error" berhenti berarti.
    ".claude/**",
    "**/.next/**",
  ]),
]);

export default eslintConfig;
