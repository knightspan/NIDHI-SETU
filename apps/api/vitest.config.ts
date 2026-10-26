import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is needed because esbuild (Vite's default) does not emit decorator metadata,
// which NestJS dependency injection relies on.
const plugins = [swc.vite({ module: { type: 'es6' } })];

export default defineConfig({
  test: {
    projects: [
      {
        plugins,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        plugins,
        test: {
          name: 'integration',
          include: ['test/**/*.test.ts'],
          setupFiles: ['test/setup-env.ts'],
          globalSetup: ['test/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**'],
      exclude: ['src/**/*.test.ts'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
