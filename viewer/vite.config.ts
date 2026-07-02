import { defineConfig } from "vite";

import { observabilitySessionPlugin } from "./dev/observabilitySession";

export default defineConfig(() => {
  const plugins = process.env.VITEST
    ? []
    : [observabilitySessionPlugin()];
  const config = {
    plugins,
    server: {
      historyApiFallback: true
    },
    test: {
      environment: "jsdom"
    }
  };
  return config;
});
