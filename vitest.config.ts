import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    server: {
      deps: {
        inline: [/matrix-js-sdk/, /matrix-events-sdk/],
      },
    },
  },
});
