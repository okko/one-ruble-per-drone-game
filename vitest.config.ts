import { defineConfig } from 'vitest/config';

// Default environment is `node` (fast, for pure logic). DOM/canvas-touching tests
// opt in per-file with `// @vitest-environment jsdom` (docs/areas/00-core-platform.md §3.1.3).
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      // Always-on so the documented `npm run check` (= `... && vitest run`) enforces the
      // thresholds without a separate flag (docs/testing.md §2 "with coverage").
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      // Coverage thresholds apply to the logic this project owns. main.ts (the rAF/clock
      // edge) is excluded — its accumulator math lives in the covered pure core/loop.ts.
      include: [
        'src/core/**',
        'src/content/**',
        'src/persistence/**',
        'src/input/**',
        // Phase 2 gameplay logic (meters, economy, scoring, incidents) + the relief bridge.
        'src/systems/**',
        'src/state/scene-manager.ts',
        'src/state/create-game-state.ts',
        // Presentation overhaul: the pure UI modules that carry the gate now that the
        // Canvas-2D pipeline is retired (docs/testing.md §3).
        'src/ui/shell/menu-model.ts',
        // The presentation maths of the three.js layer: pure, three.js-free modules extracted so the
        // arena↔world mapping and the camera states are proven by test rather than by eye
        // (docs/testing.md §3).
        'src/render/three/mapping.ts',
        'src/render/three/camera-director.ts',
        'src/render/three/soldier.ts',
        'src/render/three/theme.ts',
      ],
      // game-state.ts is pure interfaces (no runtime); test-support helpers are not product logic.
      exclude: ['**/*.test.ts', '**/__fixtures__/**', 'src/test-support/**'],
      // Committed thresholds — lowering any of these requires lead sign-off (CODEOWNERS
      // guards this file). Lines-only is gameable by an AI; branches+functions close the gap.
      thresholds: {
        lines: 85,
        branches: 85,
        functions: 85,
      },
    },
  },
});
