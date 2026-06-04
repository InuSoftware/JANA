import { describe, it, expect, beforeEach } from "vitest";
import { loadJana, seedOrders, seedShifts } from "../helpers/load-jana.js";
import {
  makeDailyCloseRow,
  makeFinalizedOrder,
  makeOrder,
  makeShift,
  PRODUCT_A,
  PRODUCT_B
} from "../helpers/fixtures.js";
import {
  cashCloseDraftForSnapshot,
  orderDocForSnapshot,
  paymentSharesForSnapshot,
  shiftLikeStableFields,
  sortKeysDeep
} from "../helpers/snapshot-stable.js";

describe("snapshots: configuração padrão do app", () => {
  it("defaultConfigPayload mantém estrutura de categorias e pagamentos", () => {
    const j = loadJana();
    expect(sortKeysDeep(j.defaultConfigPayload())).toMatchSnapshot();
  });
});

describe("snapshots: mapeamento produto DB ↔ app", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("productRowToApp normaliza linha Supabase com estoque", () => {
    const row = {
      id: PRODUCT_A.id,
      name: "Cerveja",
      category: "Bebidas",
      price: 12.5,
      requires_prep: true
    };
    expect(j.productRowToApp(row, 7)).toMatchSnapshot();
  });

  it("productToRow reverte modelo do app para colunas snake_case", () => {
    expect(j.productToRow(PRODUCT_B)).toMatchSnapshot();
  });
});

describe("snapshots: documento de comanda (payload gravado)", () => {
  it("commandaPayloadDocument remove id e ordena itens", () => {
    const j = loadJana();
    const order = makeFinalizedOrder({
      items: [
        {
          lineId: "line-b",
          productId: PRODUCT_B.id,
          name: PRODUCT_B.name,
          price: 28,
          qty: 1,
          requiresPrep: true,
          requestedAt: "2026-05-15T19:00:00.000Z"
        },
        {
          lineId: "line-a",
          productId: PRODUCT_A.id,
          name: PRODUCT_A.name,
          price: 12.5,
          qty: 2,
          requiresPrep: false,
          requestedAt: "2026-05-15T18:30:00.000Z"
        }
      ]
    });
    expect(orderDocForSnapshot(j.commandaPayloadDocument(order))).toMatchSnapshot();
  });
});

describe("snapshots: turno / fechamento legado", () => {
  it("shiftRowToApp mapeia colunas shifts", () => {
    const j = loadJana();
    const row = {
      id: makeShift().id,
      reference_date: "2026-05-15",
      scheduled_start: "18:00:00",
      scheduled_end: "02:00:00",
      window_start_at: "2026-05-15T18:00:00.000Z",
      window_end_at: "2026-05-16T02:00:00.000Z",
      started_at: "2026-05-15T18:00:00.000Z",
      ended_at: null,
      status: "aberto",
      payload: { inferredFromOpenOrders: true }
    };
    expect(sortKeysDeep(j.shiftRowToApp(row))).toMatchSnapshot();
  });

  it("dailyCloseRowToShiftLike expõe campos estáveis do fechamento antigo", () => {
    const j = loadJana();
    const legacy = j.dailyCloseRowToShiftLike(makeDailyCloseRow());
    expect(shiftLikeStableFields(legacy)).toMatchSnapshot();
  });
});

describe("snapshots: agregações de relatório", () => {
  let j;
  const orders = [
    makeFinalizedOrder({
      id: "ord-2",
      totalPaid: 60,
      paymentMethods: ["Dinheiro", "PIX"],
      items: [{ productId: PRODUCT_B.id, name: "Batata", price: 28, qty: 1 }]
    }),
    makeFinalizedOrder({
      id: "ord-1",
      totalPaid: 25,
      paymentMethods: ["PIX"],
      items: [{ productId: PRODUCT_A.id, name: "Cerveja", price: 12.5, qty: 2 }]
    })
  ];

  beforeEach(() => {
    j = loadJana();
  });

  it("aggregatePaymentMethodShares rateia e ordena por nome", () => {
    const map = j.aggregatePaymentMethodShares(orders);
    expect(paymentSharesForSnapshot(map)).toMatchSnapshot();
  });

  it("aggregateTopProducts ranqueia por quantidade", () => {
    const top = j.aggregateTopProducts(orders, 10);
    expect(
      top.map((row) => ({ name: row.name, qty: row.qty, revenue: row.revenue })).sort((a, b) => b.qty - a.qty)
    ).toMatchSnapshot();
  });

  it("aggregatePeakHour conta por hora local com fechamentos fixos", () => {
    const { counts, peakHourIndex } = j.aggregatePeakHour(orders);
    expect({ counts, peakHourIndex }).toMatchSnapshot();
  });
});

describe("snapshots: rascunho de fechamento de caixa", () => {
  it("computeCashCloseDraft resume vendas do turno sem timestamps", () => {
    const j = loadJana();
    const shift = makeShift({ id: "shift-snap-1" });
    seedShifts(j, [shift]);
    seedOrders(j, [
      makeOrder({ id: "open-1", customer: "Cliente aberto" }),
      makeFinalizedOrder({
        id: "fin-1",
        customer: "Ana",
        shiftId: shift.id,
        closedAt: "2026-05-15T19:00:00.000Z",
        totalPaid: 40,
        paymentMethods: ["PIX", "Dinheiro"],
        items: [{ productId: PRODUCT_A.id, name: "Cerveja", price: 12.5, qty: 2 }]
      })
    ]);
    const draft = j.computeCashCloseDraft(shift);
    expect(cashCloseDraftForSnapshot(draft)).toMatchSnapshot();
  });
});

describe("snapshots: snapshot de fechamento já persistido", () => {
  it("shiftCloseReportSnapshot usa closeSnapshot embutido", () => {
    const j = loadJana();
    const shift = {
      payload: {
        closeSnapshot: {
          totalBruto: 250.5,
          finalizedOrdersCount: 4,
          activeOrdersCount: 2,
          sales: [{ orderId: "x", customer: "Test", totalPaid: 10 }]
        }
      }
    };
    expect(sortKeysDeep(j.shiftCloseReportSnapshot(shift))).toMatchSnapshot();
  });
});
