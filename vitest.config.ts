import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Testes do sisTrama. Dois níveis:
//   tests/unit/         → funções TS puras (sem banco). Rodam em qualquer lugar.
//   tests/integration/  → chamam as RPCs/checam invariantes no banco REAL, sempre
//                         em BEGIN…ROLLBACK (não gravam nada). Pulam sozinhos se não
//                         houver credencial (DATABASE_URL ou /tmp/dburl.txt).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
