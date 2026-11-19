import { defineConfig, configDefaults } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    // No test may reach Knock, even when a real key is in the shell.
    env: { KNOCK_API_KEY: "" },
    exclude: [...configDefaults.exclude],
  },
});
