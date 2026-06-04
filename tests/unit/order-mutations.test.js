import { describe, it, expect, beforeEach } from "vitest";
import { loadJana, seedProducts, seedOrders, attachSupabaseMock } from "../helpers/load-jana.js";
import { createSupabaseMock } from "../helpers/supabase-mock.js";
import { PRODUCT_A, PRODUCT_B, makeOrder } from "../helpers/fixtures.js";

describe("findMergeTargetLineForProduct", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: encontra linha aberta do mesmo produto", () => {
    const items = [{ productId: "p1", requiresPrep: false, qty: 1 }];
    expect(j.findMergeTargetLineForProduct(items, "p1")).toBe(items[0]);
  });

  it("fronteiras: prep entregue não funde", () => {
    const items = [{ productId: "p1", requiresPrep: true, deliveredAt: "2026-05-15T19:00:00.000Z" }];
    expect(j.findMergeTargetLineForProduct(items, "p1")).toBeNull();
  });

  it("entradas inválidas: items null", () => {
    expect(j.findMergeTargetLineForProduct(null, "p1")).toBeNull();
  });

  it("invariantes: retorno null ou referência do array original", () => {
    const items = [{ productId: "x", requiresPrep: false }];
    const found = j.findMergeTargetLineForProduct(items, "x");
    expect(found === null || items.includes(found)).toBe(true);
  });
});

describe("addItemToOrder", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
    seedProducts(j, [PRODUCT_A, PRODUCT_B]);
    attachSupabaseMock(j, createSupabaseMock());
  });

  it("happy path: adiciona item em comanda existente", async () => {
    seedOrders(j, [makeOrder({ id: "o1", items: [] })]);
    j.state.selectedOrderId = "o1";
    await j.addItemToOrder(PRODUCT_A.id);
    const order = j.loadOrders()[0];
    expect(order.items).toHaveLength(1);
    expect(order.items[0].qty).toBe(1);
    expect(j.getProductStock(PRODUCT_A.id)).toBe(19);
  });

  it("fronteiras: funde qty em linha existente", async () => {
    seedOrders(j, [
      makeOrder({
        id: "o1",
        items: [{ productId: PRODUCT_A.id, name: "A", price: 10, qty: 2, requiresPrep: false }]
      })
    ]);
    j.state.selectedOrderId = "o1";
    await j.addItemToOrder(PRODUCT_A.id);
    expect(j.loadOrders()[0].items).toHaveLength(1);
    expect(j.loadOrders()[0].items[0].qty).toBe(3);
  });

  it("entradas inválidas: produto inexistente não altera pedidos", async () => {
    seedOrders(j, [makeOrder({ id: "o1" })]);
    j.state.selectedOrderId = "o1";
    await j.addItemToOrder("missing");
    expect(j.loadOrders()[0].items).toHaveLength(0);
  });

  it("estado: múltiplas adições decrementam estoque", async () => {
    seedOrders(j, [makeOrder({ id: "o1" })]);
    j.state.selectedOrderId = "o1";
    await j.addItemToOrder(PRODUCT_A.id);
    await j.addItemToOrder(PRODUCT_A.id);
    expect(j.getProductStock(PRODUCT_A.id)).toBe(18);
  });
});

describe("changeItemQty", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
    seedProducts(j, [PRODUCT_B]);
  });

  it("happy path: incrementa qty", () => {
    const order = makeOrder({
      items: [{ productId: PRODUCT_B.id, name: "B", price: 10, qty: 1, requiresPrep: false }]
    });
    seedOrders(j, [order]);
    j.state.selectedOrderId = order.id;
    j.changeItemQty(0, 1);
    expect(j.getCurrentOrder().items[0].qty).toBe(2);
  });

  it("fronteiras: qty zero remove linha", () => {
    const order = makeOrder({
      items: [{ productId: PRODUCT_B.id, name: "B", price: 10, qty: 1, requiresPrep: false }]
    });
    seedOrders(j, [order]);
    j.state.selectedOrderId = order.id;
    j.changeItemQty(0, -1);
    expect(j.getCurrentOrder().items).toHaveLength(0);
  });

  it("entradas inválidas: índice inválido", () => {
    seedOrders(j, [makeOrder()]);
    j.state.selectedOrderId = j.loadOrders()[0].id;
    expect(() => j.changeItemQty(99, 1)).not.toThrow();
    expect(j.getCurrentOrder().items).toHaveLength(0);
  });
});

describe("deleteCategory / deletePaymentMethod / deleteProduct", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
    attachSupabaseMock(j, createSupabaseMock());
    seedProducts(j, [PRODUCT_A]);
  });

  it("deleteCategory remove categoria do config", () => {
    j.state.config.categories = ["Bebidas", "X"];
    j.deleteCategory("X");
    expect(j.state.config.categories).toEqual(["Bebidas"]);
  });

  it("deletePaymentMethod remove forma de pagamento", () => {
    const before = j.state.config.paymentMethods.length;
    j.deletePaymentMethod("pix");
    expect(j.state.config.paymentMethods.length).toBe(before - 1);
    expect(j.state.config.paymentMethods.some((m) => m.id === "pix")).toBe(false);
  });

  it("deleteProduct remove produto localmente", async () => {
    await j.deleteProduct(PRODUCT_A.id);
    expect(j.loadProducts()).toHaveLength(0);
  });

  it("fronteiras: deleteCategory inexistente não quebra", () => {
    j.deleteCategory("Inexistente");
    expect(Array.isArray(j.state.config.categories)).toBe(true);
  });
});

describe("markLineDelivered", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: marca item prep como entregue", () => {
    const lineId = "line-1";
    const order = makeOrder({
      items: [
        {
          lineId,
          productId: PRODUCT_B.id,
          name: "B",
          price: 10,
          qty: 1,
          requiresPrep: true,
          requestedAt: "2026-05-15T18:00:00.000Z"
        }
      ]
    });
    seedOrders(j, [order]);
    j.state.selectedOrderId = order.id;
    j.markLineDelivered(lineId);
    const item = j.getCurrentOrder().items[0];
    expect(item.deliveredAt).toBeTruthy();
    expect(item.serviceSeconds).toBeGreaterThanOrEqual(0);
  });

  it("fronteiras: lineId vazio retorna cedo", () => {
    expect(() => j.markLineDelivered("")).not.toThrow();
  });

  it("entradas inválidas: comanda finalizada não altera", () => {
    const order = makeOrder({
      status: "Finalizado",
      items: [{ lineId: "l1", requiresPrep: true, requestedAt: "2026-05-15T18:00:00.000Z" }]
    });
    seedOrders(j, [order]);
    j.state.selectedOrderId = order.id;
    j.markLineDelivered("l1");
    expect(j.getCurrentOrder().items[0].deliveredAt).toBeUndefined();
  });
});

describe("scheduleHorizontalScrollHints", () => {
  it("estado: agenda callback via rAF", () => {
    const j = loadJana();
    let called = false;
    j.scheduleHorizontalScrollHints(() => {
      called = true;
    });
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(called).toBe(true);
        resolve();
      }, 20);
    });
  });
});

describe("getSupabase / isSupabaseConfigured integração", () => {
  it("happy path: retorna client injetado", async () => {
    const j = loadJana();
    const mock = attachSupabaseMock(j, createSupabaseMock());
    expect(await j.getSupabase()).toBe(mock);
  });

  it("fronteiras: sem config retorna null", async () => {
    const j = loadJana();
    window.__SUPABASE_URL__ = "";
    j.resetSupabaseClientForTests();
    expect(await j.getSupabase()).toBeNull();
    window.__SUPABASE_URL__ = "https://example.supabase.co";
  });
});
