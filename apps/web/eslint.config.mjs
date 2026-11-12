import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The 3D scene drives three.js objects imperatively every frame (materials, matrices, uniforms) instead of
    // through React state — that is the point of react-three-fiber's useFrame. The React-compiler purity rules
    // do not apply to that code.
    files: ["src/components/twin/**"],
    rules: { "react-hooks/immutability": "off", "react-hooks/refs": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "reference/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
