import { describe, it, expect, beforeEach } from "vitest";
import { loadJana, seedProducts, seedOrders, seedShifts } from "../helpers/load-jana.js";
import { PRODUCT_A, PRODUCT_B, makeOrder, makeFinalizedOrder, makeShift } from "../helpers/fixtures.js";

describe("getProductStock / setProductStockLocal / applyStockDeltaSilently", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
    seedProducts(j, [PRODUCT_A, PRODUCT_B]);
  });

  it("happy path: leitura, escrita e delta", () => {
    expect(j.getProductStock(PRODUCT_A.id)).toBe(20);
    j.setProductStockLocal(PRODUCT_A.id, 15);
    expect(j.getProductStock(PRODUCT_A.id)).toBe(15);
    j.applyStockDeltaSilently(PRODUCT_A.id, -3);
    expect(j.getProductStock(PRODUCT_A.id)).toBe(12);
  });

  it("fronteiras: produto inexistente, delta zero, qty decimal", () => {
    expect(j.getProductStock("missing")).toBe(0);
    j.applyStockDeltaSilently(PRODUCT_A.id, 0);
    expect(j.getProductStock(PRODUCT_A.id)).toBe(20);
    j.setProductStockLocal(PRODUCT_A.id, 4.8);
    expect(j.getProductStock(PRODUCT_A.id)).toBe(4);
  });

  it("entradas inválidas: productId vazio não altera", () => {
    const before = j.getProductStock(PRODUCT_A.id);
    j.applyStockDeltaSilently("", 5);
    j.applyStockDeltaSilently(null, 5);
    expect(j.getProductStock(PRODUCT_A.id)).toBe(before);
  });

  it("estado: múltiplos deltas acumulam", () => {
    j.applyStockDeltaSilently(PRODUCT_A.id, -1);
    j.applyStockDeltaSilently(PRODUCT_A.id, -2);
    expect(j.getProductStock(PRODUCT_A.id)).toBe(17);
  });

  it("invariantes: estoque local é inteiro truncado", () => {
    j.setProductStockLocal(PRODUCT_A.id, "9.9");
    expect(j.getProductStock(PRODUCT_A.id)).toBe(9);
    expect(Number.isInteger(j.getProductStock(PRODUCT_A.id))).toBe(true);
  });
});

describe("restoreOrderItemsToStock", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
    seedProducts(j, [PRODUCT_A]);
    j.setProductStockLocal(PRODUCT_A.id, 10);
  });

  it("happy path: restaura qty de itens", () => {
    j.restoreOrderItemsToStock([
      { productId: PRODUCT_A.id, qty: 2 },
      { productId: PRODUCT_A.id, qty: 1 }
    ]);
    expect(j.getProductStock(PRODUCT_A.id)).toBe(13);
  });

  it("fronteiras: array vazio, null, qty zero", () => {
    j.restoreOrderItemsToStock([]);
    expect(j.getProductStock(PRODUCT_A.id)).toBe(10);
    j.restoreOrderItemsToStock(null);
    expect(j.getProductStock(PRODUCT_A.id)).toBe(10);
    j.restoreOrderItemsToStock([{ productId: PRODUCT_A.id, qty: 0 }]);
    expect(j.getProductStock(PRODUCT_A.id)).toBe(10);
  });

  it("invariantes: nunca reduz estoque nesta função", () => {
    const before = j.getProductStock(PRODUCT_A.id);
    j.restoreOrderItemsToStock([{ productId: PRODUCT_A.id, qty: 3 }]);
    expect(j.getProductStock(PRODUCT_A.id)).toBeGreaterThanOrEqual(before);
  });
});

describe("calculateOrderSubtotal", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: soma price * qty", () => {
    const order = makeOrder({
      items: [
        { price: 10, qty: 2 },
        { price: 5.5, qty: 1 }
      ]
    });
    expect(j.calculateOrderSubtotal(order)).toBe(25.5);
  });

  it("fronteiras: sem items, items vazio", () => {
    expect(j.calculateOrderSubtotal({})).toBe(0);
    expect(j.calculateOrderSubtotal(makeOrder({ items: [] }))).toBe(0);
  });

  it("invariantes: subtotal >= 0 para qty >= 0", () => {
    const sub = j.calculateOrderSubtotal(makeOrder({ items: [{ price: 3, qty: 4 }] }));
    expect(sub).toBeGreaterThanOrEqual(0);
  });
});

describe("calculatePaidInDateRange / finalizedOrdersInLocalDateRange", () => {
  let j;
  const orders = [
    makeFinalizedOrder({ id: "1", closedAt: "2026-05-14T23:00:00.000Z", totalPaid: 100 }),
    makeFinalizedOrder({ id: "2", closedAt: "2026-05-15T12:00:00.000Z", totalPaid: 50 }),
    makeOrder({ id: "3", status: "Aberta" })
  ];

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: filtra finalizados no intervalo", () => {
    const paid = j.calculatePaidInDateRange(orders, "2026-05-15", "2026-05-15");
    const slice = j.finalizedOrdersInLocalDateRange(orders, "2026-05-15", "2026-05-15");
    expect(paid).toBe(50);
    expect(slice.map((o) => o.id)).toEqual(["2"]);
  });

  it("fronteiras: from/to vazio retorna 0 ou []", () => {
    expect(j.calculatePaidInDateRange(orders, "", "2026-05-15")).toBe(0);
    expect(j.finalizedOrdersInLocalDateRange(orders, "2026-05-15", "")).toEqual([]);
  });

  it("invariantes: total pago >= 0", () => {
    expect(j.calculatePaidInDateRange(orders, "2026-05-01", "2026-05-31")).toBeGreaterThanOrEqual(0);
  });
});

describe("aggregatePaymentMethodShares", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: rateio igual entre métodos", () => {
    const map = j.aggregatePaymentMethodShares([
      makeFinalizedOrder({ totalPaid: 100, paymentMethods: ["PIX", "Dinheiro"] })
    ]);
    expect(map.PIX).toBe(50);
    expect(map.Dinheiro).toBe(50);
  });

  it("fronteiras: um método, total zero, sem métodos", () => {
    expect(j.aggregatePaymentMethodShares([makeFinalizedOrder({ totalPaid: 30, paymentMethods: ["PIX"] })]).PIX).toBe(30);
    expect(j.aggregatePaymentMethodShares([makeFinalizedOrder({ totalPaid: 0, paymentMethods: ["PIX"] })])).toEqual({});
    expect(j.aggregatePaymentMethodShares([makeFinalizedOrder({ totalPaid: 10, paymentMethods: [] })])).toEqual({});
  });

  it("invariantes: soma das shares <= soma totalPaid", () => {
    const orders = [
      makeFinalizedOrder({ totalPaid: 90, paymentMethods: ["A", "B", "C"] }),
      makeFinalizedOrder({ totalPaid: 10, paymentMethods: ["PIX"] })
    ];
    const map = j.aggregatePaymentMethodShares(orders);
    const sumShares = Object.values(map).reduce((a, b) => a + b, 0);
    const sumPaid = orders.reduce((a, o) => a + o.totalPaid, 0);
    expect(sumShares).toBeLessThanOrEqual(sumPaid + 0.001);
  });
});

describe("aggregateTopProducts", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: ordena por qty decrescente", () => {
    const top = j.aggregateTopProducts([
      makeFinalizedOrder({
        items: [
          { productId: "a", name: "A", price: 10, qty: 1 },
          { productId: "b", name: "B", price: 5, qty: 5 }
        ]
      })
    ], 10);
    expect(top[0].name).toBe("B");
    expect(top[0].qty).toBe(5);
  });

  it("fronteiras: limit=1, sem itens", () => {
    expect(j.aggregateTopProducts([makeOrder()], 1)).toEqual([]);
    const one = j.aggregateTopProducts([makeFinalizedOrder({ items: [{ productId: "x", name: "X", price: 1, qty: 2 }] })], 1);
    expect(one).toHaveLength(1);
  });

  it("invariantes: revenue = price*qty agregado por produto", () => {
    const top = j.aggregateTopProducts([
      makeFinalizedOrder({ items: [{ productId: "p", name: "P", price: 4, qty: 3 }] })
    ]);
    expect(top[0].revenue).toBe(12);
    expect(top[0].qty).toBe(3);
  });
});

describe("aggregatePeakHour / aggregateWeekday", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: conta por hora e dia da semana", () => {
    const peak = j.aggregatePeakHour([
      makeFinalizedOrder({ closedAt: "2026-05-15T19:00:00.000Z", totalPaid: 10 }),
      makeFinalizedOrder({ closedAt: "2026-05-15T19:30:00.000Z", totalPaid: 20 })
    ]);
    expect(peak.counts.some((c) => c > 0)).toBe(true);
    expect(peak.peakHourIndex).not.toBeNull();

    const wd = j.aggregateWeekday([makeFinalizedOrder({ closedAt: "2026-05-15T12:00:00.000Z", totalPaid: 5 })]);
    expect(wd.counts.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("fronteiras: orders vazio", () => {
    const peak = j.aggregatePeakHour([]);
    expect(peak.peakHourIndex).toBeNull();
    expect(j.aggregateWeekday([]).peakWeekdayIndex).toBeNull();
  });

  it("invariantes: arrays de tamanho fixo 24 e 7", () => {
    const peak = j.aggregatePeakHour([makeFinalizedOrder()]);
    const wd = j.aggregateWeekday([makeFinalizedOrder()]);
    expect(peak.counts).toHaveLength(24);
    expect(peak.revenue).toHaveLength(24);
    expect(wd.counts).toHaveLength(7);
  });
});

describe("paymentSharesSorted", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: ordena decrescente por value", () => {
    const rows = j.paymentSharesSorted({ PIX: 10, Dinheiro: 50, Cartao: 30 });
    expect(rows[0].name).toBe("Dinheiro");
    expect(rows[rows.length - 1].name).toBe("PIX");
  });

  it("fronteiras: mapa vazio", () => {
    expect(j.paymentSharesSorted({})).toEqual([]);
  });
});

describe("orderBelongsToShift / ordersFinalizedInShift", () => {
  let j;
  const shift = makeShift({
    startedAt: "2026-05-15T18:00:00.000Z",
    endedAt: "2026-05-15T23:00:00.000Z",
    status: "fechado"
  });

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: por shiftId e por janela temporal", () => {
    const byId = makeFinalizedOrder({ shiftId: shift.id, closedAt: "2026-05-14T10:00:00.000Z" });
    const byTime = makeFinalizedOrder({ closedAt: "2026-05-15T20:00:00.000Z" });
    expect(j.orderBelongsToShift(byId, shift)).toBe(true);
    expect(j.orderBelongsToShift(byTime, shift)).toBe(true);
    const slice = j.ordersFinalizedInShift([byId, byTime, makeOrder()], shift);
    expect(slice).toHaveLength(2);
  });

  it("fronteiras: shift null, order aberta", () => {
    expect(j.ordersFinalizedInShift([makeOrder()], null)).toEqual([]);
    expect(j.orderBelongsToShift(makeOrder(), shift)).toBe(false);
  });

  it("invariantes: só finalizados entram no slice", () => {
    const slice = j.ordersFinalizedInShift(
      [makeOrder(), makeFinalizedOrder({ closedAt: "2026-05-15T19:00:00.000Z" })],
      shift
    );
    expect(slice.every((o) => j.normalizeOrderStatus(o.status) === "Finalizado")).toBe(true);
  });
});

describe("computeCashCloseDraft", () => {
  let j;
  const shift = makeShift();

  beforeEach(() => {
    j = loadJana();
    seedOrders(j, [
      makeOrder({ id: "open1" }),
      makeFinalizedOrder({ id: "f1", shiftId: shift.id, closedAt: "2026-05-15T19:00:00.000Z", totalPaid: 40 })
    ]);
    seedShifts(j, [shift]);
  });

  it("happy path: agrega vendas do turno", () => {
    const draft = j.computeCashCloseDraft(shift);
    expect(draft.shiftId).toBe(shift.id);
    expect(draft.finalizedOrdersCount).toBe(1);
    expect(draft.totalBruto).toBe(40);
    expect(draft.activeOrdersCount).toBe(1);
  });

  it("fronteiras: shift null", () => {
    const draft = j.computeCashCloseDraft(null);
    expect(draft.shiftId).toBeNull();
    expect(draft.totalBruto).toBe(0);
  });

  it("invariantes: sales.length === finalizedOrdersCount", () => {
    const draft = j.computeCashCloseDraft(shift);
    expect(draft.sales.length).toBe(draft.finalizedOrdersCount);
  });
});

describe("performReopenOrder", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
    j.state.user = { email: "gerente@test.com" };
    seedOrders(j, [
      makeFinalizedOrder({ id: "r1", totalPaid: 80, paymentMethods: ["PIX"] }),
      makeOrder({ id: "r2" })
    ]);
  });

  it("happy path: reabre finalizada", () => {
    expect(j.performReopenOrder("r1")).toBe(true);
    const order = j.loadOrders().find((o) => o.id === "r1");
    expect(order.status).toBe("Aberta");
    expect(order.totalPaid).toBe(0);
    expect(order.paymentMethods).toEqual([]);
    expect(order.reopenHistory?.length).toBe(1);
  });

  it("fronteiras: id inexistente, comanda aberta", () => {
    expect(j.performReopenOrder("missing")).toBe(false);
    expect(j.performReopenOrder("r2")).toBe(false);
  });

  it("estado: segunda tentativa em comanda já aberta falha", () => {
    j.performReopenOrder("r1");
    expect(j.performReopenOrder("r1")).toBe(false);
  });
});

describe("ensureLineIds / computeServiceSeconds", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: gera lineId e calcula segundos", () => {
    const order = makeOrder({
      items: [{ name: "X", price: 1, qty: 1, requiresPrep: true, requestedAt: "2026-05-15T18:00:00.000Z" }]
    });
    expect(j.ensureLineIds(order)).toBe(true);
    expect(order.items[0].lineId).toBeTruthy();

    const sec = j.computeServiceSeconds("2026-05-15T18:00:00.000Z", "2026-05-15T18:05:00.000Z");
    expect(sec).toBe(300);
  });

  it("fronteiras: delivered antes de requested retorna 0", () => {
    expect(j.computeServiceSeconds("2026-05-15T19:00:00.000Z", "2026-05-15T18:00:00.000Z")).toBe(0);
    expect(j.computeServiceSeconds(null, "2026-05-15T18:00:00.000Z")).toBeNull();
  });

  it("invariantes: serviceSeconds >= 0 quando definido", () => {
    const sec = j.computeServiceSeconds("2026-05-15T18:00:00.000Z", "2026-05-15T18:01:00.000Z");
    expect(sec).toBeGreaterThanOrEqual(0);
  });
});
