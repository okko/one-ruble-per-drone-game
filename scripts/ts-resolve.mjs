// Module resolve hook for the build scripts.
//
// Node strips TypeScript types natively (22.18+), but its ESM resolver still demands a file
// extension, while every import in `src/` is extensionless because Vite and `tsc` resolve them.
// Rather than sprinkle `.ts` through application imports to suit a build script — inverting who
// serves whom — this hook appends the extension on the way past.
//
// Only relative specifiers are touched, and only when they have no extension already, so bare
// package imports and explicit paths resolve exactly as they otherwise would.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier) && !specifier.endsWith('.json')) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // Not a TypeScript module after all — let the default resolver report the real failure.
    }
  }
  return nextResolve(specifier, context);
}
