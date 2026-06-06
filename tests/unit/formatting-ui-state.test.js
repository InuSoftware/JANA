import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadJana, seedOrders, seedProducts } from "../helpers/load-jana.js";
import { PRODUCT_A, makeOrder, makeFinalizedOrder } from "../helpers/fixtures.js";

describe("formatting helpers", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("formatYmdWithWeekday: happy path e vazio", () => {
    expect(j.formatYmdWithWeekday("2026-05-15")).toMatch(/,/);
    expect(j.formatYmdWithWeekday("")).toBe("");
  });

  it("formatDateTimeShort: happy path e vazio", () => {
    expect(j.formatDateTimeShort("2026-05-15T15:00:00.000Z")).not.toBe("—");
    expect(j.formatDateTimeShort("")).toBe("—");
  });

  it("formatTimeShort / formatDurationFromSeconds", () => {
    expect(j.formatTimeShort("2026-05-15T15:30:00.000Z")).toMatch(/\d{2}:\d{2}/);
    expect(j.formatTimeShort("")).toBe("");
    expect(j.formatDurationFromSeconds(45)).toBe("45s");
    expect(j.formatDurationFromSeconds(125)).toBe("2min 5s");
    expect(j.formatDurationFromSeconds(null)).toBe("");
  });

  it("formatElapsedSince / formatElapsedClock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T19:05:00.000Z"));
    expect(j.formatElapsedSince("2026-05-15T19:00:00.000Z")).toBe("5min");
    expect(j.formatElapsedClock("2026-05-15T19:00:00.000Z")).toBe("05:00");
    vi.useRealTimers();
  });

  it("formatProductStockHint invariantes: contém qty inteiro", () => {
    expect(j.formatProductStockHint(12.7)).toContain("12 un.");
  });

  it("localYmdFromIso / todayLocalYmd / orderReopenEventYmd", () => {
    expect(j.localYmdFromIso("2026-05-15T23:00:00.000Z")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(j.localYmdFromIso("")).toBe("");
    expect(j.todayLocalYmd()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(j.orderReopenEventYmd(makeFinalizedOrder())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(j.orderReopenEventYmd(makeOrder())).toBe("");
  });

  it("formatShiftLabel: aberto e fechado", () => {
    expect(j.formatShiftLabel(null)).toBe("");
    expect(j.formatShiftLabel({ status: "aberto", startedAt: "2026-05-15T18:00:00.000Z" })).toContain("aberto");
    expect(j.formatShiftLabel({ status: "fechado", startedAt: "2026-05-15T18:00:00.000Z" })).toContain("fechado");
  });

  it("deriveOrderStatus", () => {
    expect(j.deriveOrderStatus(makeOrder())).toBe("Aberta");
    expect(j.deriveOrderStatus(makeFinalizedOrder())).toBe("Finalizado");
  });
});

describe("categoryRequiresPrep", () => {
  it("happy path e fronteiras", () => {
    const j = loadJana();
    j.state.config.prepCategories = ["Porcoes"];
    expect(j.categoryRequiresPrep("Porcoes")).toBe(true);
    expect(j.categoryRequiresPrep("Bebidas")).toBe(false);
  });
});

describe("formatOrderIdentification / formatOrderSubline", () => {
  it("happy path com e sem mesa", () => {
    const j = loadJana();
    j.state.config.useTables = true;
    const order = makeOrder({ customer: "Joao", table: "5" });
    expect(j.formatOrderIdentification(order)).toContain("Joao");
    expect(j.formatOrderIdentification(order)).toContain("5");
    expect(j.formatOrderSubline(order)).toContain("5");
  });

  it("fronteiras: cliente vazio", () => {
    const j = loadJana();
    expect(j.formatOrderIdentification(makeOrder({ customer: "  " }))).toContain("Cliente sem nome");
  });
});

describe("formatOpenOrdersCashCloseHint", () => {
  it("happy path: lista comandas abertas", () => {
    const j = loadJana();
    seedOrders(j, [
      makeOrder({ customer: "Ana" }),
      makeOrder({ id: "2", customer: "Bob" })
    ]);
    const hint = j.formatOpenOrdersCashCloseHint(1);
    expect(hint).toContain("2 comandas em aberto");
    expect(hint).toContain("Ana");
    expect(hint).toContain("mais 1");
  });

  it("fronteiras: nenhuma aberta retorna vazio", () => {
    const j = loadJana();
    seedOrders(j, [makeFinalizedOrder()]);
    expect(j.formatOpenOrdersCashCloseHint()).toBe("");
  });
});

describe("pending order state", () => {
  it("abandonPendingOrder restaura estoque", () => {
    const j = loadJana();
    seedProducts(j, [{ ...PRODUCT_A, stock: 10 }]);
    j.state.pendingNewOrder = makeOrder({
      items: [{ productId: PRODUCT_A.id, qty: 2 }]
    });
    j.state.selectedOrderId = j.PENDING_ORDER_ID;
    j.abandonPendingOrder();
    expect(j.state.pendingNewOrder).toBeNull();
    expect(j.getProductStock(PRODUCT_A.id)).toBe(12);
  });

  it("isPendingLocalOrder / getCurrentOrder", () => {
    const j = loadJana();
    j.state.pendingNewOrder = makeOrder();
    j.state.selectedOrderId = j.PENDING_ORDER_ID;
    expect(j.isPendingLocalOrder()).toBe(true);
    expect(j.getCurrentOrder()?.customer).toBe("Maria");
  });
});

describe("recordOrderReopenAudit", () => {
  it("happy path: append histórico", () => {
    const j = loadJana();
    j.state.user = { email: "op@test.com" };
    const order = makeFinalizedOrder();
    j.recordOrderReopenAudit(order, "Finalizado");
    expect(order.reopenHistory).toHaveLength(1);
    expect(order.lastReopenedAt).toBeTruthy();
  });
});

describe("productCategoryFilterOptions", () => {
  it("happy path: Todas + categorias únicas", () => {
    const j = loadJana();
    seedProducts(j, [PRODUCT_A, { ...PRODUCT_A, id: "p2", category: "Lanches" }]);
    const opts = j.productCategoryFilterOptions();
    expect(opts[0]).toBe("Todas");
    expect(opts).toContain("Bebidas");
    expect(opts).toContain("Lanches");
  });
});

describe("UI render smoke (não lança com refs mockados)", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
    j.state.user = { username: "test", role: "Gerente" };
    seedProducts(j, [PRODUCT_A]);
    seedOrders(j, [makeOrder()]);
  });

  const smokeFns = [
    "renderShiftBar",
    "renderDashboard",
    "renderHeaderNavButtons",
    "renderMainPanels",
    "renderView",
    "renderProductCategoryOptions",
    "renderSettings",
    "renderProductAdminCategoryFilters",
    "renderProductAdmin",
    "renderStockAdminCategoryFilters",
    "renderStockAdmin",
    "renderCategoryOptions",
    "renderCheckoutPaymentMethods",
    "renderCashCloseHistoryOverlay",
    "renderReopenShiftPanel"
  ];

  const sampleShift = {
    referenceDate: "2026-05-15",
    startedAt: "2026-05-15T18:00:00.000Z",
    endedAt: "2026-05-15T23:00:00.000Z",
    status: "fechado",
    payload: { closeSnapshot: { totalBruto: 10, finalizedOrdersCount: 1, sales: [] } }
  };

  for (const name of smokeFns) {
    it(`${name} executa sem throw`, () => {
      if (name === "renderShiftCloseReportCard") {
        expect(() => j[name](sampleShift)).not.toThrow();
      } else {
        expect(() => j[name]()).not.toThrow();
      }
    });
  }

  it("applyTheme define data-theme", () => {
    j.state.config.activeTheme = "dark-pro";
    j.applyTheme();
    expect(j.state.config.activeTheme).toBe("dark-pro");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark-pro");
  });

  it("updateHorizontalScrollHints toggles classes", () => {
    const scroller = { scrollWidth: 200, clientWidth: 100, scrollLeft: 50 };
    const left = { classList: { toggle: vi.fn() } };
    const right = { classList: { toggle: vi.fn() } };
    j.updateHorizontalScrollHints(scroller, left, right);
    expect(left.classList.toggle).toHaveBeenCalled();
  });

  it("hideAuthBootScreen / showAuthBootScreen", () => {
    expect(() => j.showAuthBootScreen()).not.toThrow();
    expect(() => j.hideAuthBootScreen()).not.toThrow();
  });

  it("openCashCloseHistoryDialog / closeCashCloseHistoryDialog", () => {
    expect(() => j.openCashCloseHistoryDialog()).not.toThrow();
    expect(() => j.closeCashCloseHistoryDialog()).not.toThrow();
  });
});

describe("setLoggedUser / clearLoggedUser", () => {
  it("estado: login/logout limpa pending", () => {
    const j = loadJana();
    j.setLoggedUser({ username: "u", role: "Atendente" });
    expect(j.state.user.username).toBe("u");
    j.state.pendingNewOrder = makeOrder();
    j.clearLoggedUser();
    expect(j.state.user).toBeNull();
    expect(j.state.pendingNewOrder).toBeNull();
  });
});

describe("shiftCloseReportSnapshot", () => {
  it("happy path: usa snapshot quando presente", () => {
    const j = loadJana();
    const snap = j.shiftCloseReportSnapshot({
      payload: { closeSnapshot: { totalBruto: 99, finalizedOrdersCount: 3, activeOrdersCount: 0, sales: [] } }
    });
    expect(snap.totalBruto).toBe(99);
    expect(snap.finalizedOrdersCount).toBe(3);
  });

  it("fronteiras: recalcula a partir de orders", () => {
    const j = loadJana();
    const shift = {
      id: "s",
      startedAt: "2026-05-15T18:00:00.000Z",
      endedAt: "2026-05-15T23:00:00.000Z",
      status: "fechado",
      payload: {}
    };
    seedOrders(j, [makeFinalizedOrder({ closedAt: "2026-05-15T19:00:00.000Z", totalPaid: 25 })]);
    const snap = j.shiftCloseReportSnapshot(shift);
    expect(snap.totalBruto).toBe(25);
    expect(snap.finalizedOrdersCount).toBe(1);
  });
});

describe("localHmFromDate", () => {
  it("happy path: HH:MM:00", () => {
    const j = loadJana();
    const hm = j.localHmFromDate(new Date(2026, 4, 15, 9, 5, 0));
    expect(hm).toBe("09:05:00");
  });
});

describe("getOpenOrders", () => {
  it("happy path: filtra abertas normalizadas", () => {
    const j = loadJana();
    seedOrders(j, [makeOrder(), makeFinalizedOrder(), { id: "3", status: "Aguardando" }]);
    expect(j.getOpenOrders()).toHaveLength(2);
  });
});
