import fs from "node:fs";
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        main: "./src/index.js",
        remoteBindings: false,
        miniflare: {
          compatibilityDate: "2026-08-22",
          d1Databases: ["DB"],
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_STATIC_HEADERS: fs.readFileSync(path.join(import.meta.dirname, "public", "_headers"), "utf8"),
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.js"],
      setupFiles: ["./test/apply-migrations.js"],
    },
  };
});
