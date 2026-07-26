/**
 * Vite resolves `import './x.css'` into a side-effecting module that injects the
 * stylesheet. TypeScript is configured with `"types": []` (no ambient Vite
 * client types), so the import needs an explicit declaration to typecheck.
 *
 * Declaring it here — rather than pulling in `vite/client` wholesale — keeps the
 * global type surface small and deliberate.
 */
declare module '*.css' {
  const content: string;
  export default content;
}
