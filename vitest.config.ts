import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only this project's tests — never the vendored skills under .claude/ or .agents/.
    include: ["test/**/*.test.ts"],
  },
});
