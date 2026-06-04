export const PRODUCT_A = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Cerveja",
  category: "Bebidas",
  price: 12.5,
  requiresPrep: false,
  stock: 20
};

export const PRODUCT_B = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Batata",
  category: "Porcoes",
  price: 28,
  requiresPrep: true,
  stock: 5
};

export function makeOrder(overrides = {}) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    customer: "Maria",
    table: "10",
    status: "Aberta",
    items: [],
    paymentMethods: [],
    serviceFeePercent: 10,
    totalPaid: 0,
    createdAt: "2026-05-15T18:30:00.000Z",
    everHadItems: false,
    ...overrides
  };
}

export function makeFinalizedOrder(overrides = {}) {
  return makeOrder({
    status: "Finalizado",
    closedAt: "2026-05-15T20:00:00.000Z",
    totalPaid: 50,
    paymentMethods: ["PIX"],
    items: [{ lineId: "l1", productId: PRODUCT_A.id, name: PRODUCT_A.name, price: 12.5, qty: 2, requiresPrep: false }],
    everHadItems: true,
    ...overrides
  });
}

export function makeShift(overrides = {}) {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    referenceDate: "2026-05-15",
    scheduledStart: "18:00",
    scheduledEnd: "02:00",
    windowStartAt: "2026-05-15T18:00:00.000Z",
    windowEndAt: "2026-05-16T02:00:00.000Z",
    startedAt: "2026-05-15T18:00:00.000Z",
    endedAt: null,
    status: "aberto",
    payload: {},
    ...overrides
  };
}

export function makeDailyCloseRow(overrides = {}) {
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    dateYmd: "2026-05-10",
    closedAt: "2026-05-10T23:30:00.000Z",
    activeOrdersCount: 1,
    totalBruto: 120,
    finalizedOrdersCount: 3,
    sales: [
      {
        orderId: "o1",
        customer: "Joao",
        totalPaid: 40,
        paymentMethods: ["PIX"],
        itemsCount: 2,
        closedAt: "2026-05-10T22:00:00.000Z"
      }
    ],
    ...overrides
  };
}
