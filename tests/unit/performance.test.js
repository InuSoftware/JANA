import { describe, it, expect } from "vitest";
import { loadJana } from "../helpers/load-jana.js";
import { makeFinalizedOrder } from "../helpers/fixtures.js";

/**
 * Equivalente a @pytest.mark.slow — testes O(n²) ou piores.
 * Execute: npm run test:slow
 */
describe("performance @slow", () => {
  it("aggregateTopProducts escala em pedidos × itens", globalThis.SLOW, () => {
    const j = loadJana();
    const orders = [];
    for (let o = 0; o < 500; o++) {
      const items = [];
      for (let i = 0; i < 20; i++) {
        items.push({
          productId: `p-${i % 50}`,
          name: `Prod ${i}`,
          price: 10,
          qty: 1
        });
      }
      orders.push(makeFinalizedOrder({ id: `o-${o}`, items }));
    }
    const t0 = performance.now();
    const top = j.aggregateTopProducts(orders, 15);
    const elapsed = performance.now() - t0;
    expect(top.length).toBeLessThanOrEqual(15);
    expect(elapsed).toBeLessThan(5000);
  });

  it("loadAllClosedSessions sort com muitos legados", globalThis.SLOW, () => {
    const j = loadJana();
    j.state.cache.dailyCloses = Array.from({ length: 300 }, (_, i) => ({
      id: `dc-${i}`,
      dateYmd: `2024-${String((i % 12) + 1).padStart(2, "0")}-15`,
      closedAt: `2024-${String((i % 12) + 1).padStart(2, "0")}-15T23:00:00.000Z`,
      activeOrdersCount: 0,
      totalBruto: i,
      finalizedOrdersCount: 1,
      sales: []
    }));
    j.state.cache.shifts = Array.from({ length: 100 }, (_, i) => ({
      id: `s-${i}`,
      referenceDate: `2025-${String((i % 12) + 1).padStart(2, "0")}-10`,
      scheduledStart: "18:00",
      scheduledEnd: "23:00",
      startedAt: "2025-01-10T18:00:00.000Z",
      endedAt: "2025-01-10T23:00:00.000Z",
      status: "fechado",
      payload: { closeSnapshot: { totalBruto: 1, finalizedOrdersCount: 1, sales: [] } }
    }));

    const t0 = performance.now();
    const sessions = j.loadAllClosedSessions();
    const elapsed = performance.now() - t0;
    expect(sessions.length).toBeGreaterThan(300);
    expect(elapsed).toBeLessThan(5000);
  });

  it("ordersForDashboard dedupe O(n) sobre listas grandes", globalThis.SLOW, () => {
    const j = loadJana();
    const shift = {
      id: "perf-shift",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-12-31T23:59:59.000Z",
      status: "fechado",
      payload: {}
    };
    const orders = Array.from({ length: 5000 }, (_, i) =>
      makeFinalizedOrder({
        id: `f-${i}`,
        closedAt: "2026-06-01T12:00:00.000Z",
        totalPaid: 1
      })
    );
    orders.push({ id: "open-1", status: "Aberta" });

    const t0 = performance.now();
    const dash = j.ordersForDashboard(orders, shift);
    const elapsed = performance.now() - t0;
    expect(dash.length).toBe(5001);
    expect(elapsed).toBeLessThan(3000);
  });
});
