import { beforeEach, vi } from "vitest";

/** Fuso do app (relatórios e turnos legados usam hora local). */
process.env.TZ = "America/Sao_Paulo";

/** Equivalente a @pytest.mark.slow — use meta.slow nos testes de performance. */
globalThis.SLOW = { timeout: 60000, meta: { slow: true } };

beforeEach(() => {
  vi.restoreAllMocks();
});
