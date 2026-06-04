import { describe, it, expect, beforeEach } from "vitest";
import { loadJana, seedProducts, seedOrders, attachSupabaseMock } from "../helpers/load-jana.js";
import { createSupabaseMock } from "../helpers/supabase-mock.js";
import { PRODUCT_A, PRODUCT_B, makeOrder } from "../helpers/fixtures.js";

const CHURRASCO = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Churrasquinho",
  category: "Lanches",
  price: 8,
  requiresPrep: false,
  stock: 10
};

const PAO = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Pao",
  category: "Lanches",
  price: 2,
  requiresPrep: false,
  stock: 5
};

const CACHORRO = {
  id: "55555555-5555-4555-8555-555555555555",
  name: "Cachorro-quente-de-churrasco",
  category: "Lanches",
  price: 12,
  requiresPrep: true,
  stock: 0,
  isSpecial: true,
  stockComponentIds: [CHURRASCO.id, PAO.id],
  stockDisplayProductId: PAO.id
};

describe("itens especiais (compostos)", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
    seedProducts(j, [CHURRASCO, PAO, CACHORRO]);
    attachSupabaseMock(j, createSupabaseMock());
  });

  it("productToRow persiste campos especiais", () => {
    const row = j.productToRow(CACHORRO);
    expect(row.is_special).toBe(true);
    expect(row.stock_component_ids).toEqual([CHURRASCO.id, PAO.id]);
    expect(row.stock_display_product_id).toBe(PAO.id);
  });

  it("getProductStockDisplayQuantity usa insumo principal", () => {
    expect(j.getProductStockDisplayQuantity(CACHORRO)).toBe(5);
    j.setProductStockLocal(PAO.id, 2);
    expect(j.getProductStockDisplayQuantity(CACHORRO)).toBe(2);
  });

  it("addItemToOrder debita todos os insumos, nao o item especial", async () => {
    seedOrders(j, [makeOrder({ id: "o1", items: [] })]);
    j.state.selectedOrderId = "o1";
    await j.addItemToOrder(CACHORRO.id);
    expect(j.getProductStock(CACHORRO.id)).toBe(0);
    expect(j.getProductStock(CHURRASCO.id)).toBe(9);
    expect(j.getProductStock(PAO.id)).toBe(4);
  });

  it("restoreOrderItemsToStock devolve insumos", () => {
    j.applyOrderLineStockDelta(CACHORRO, -2);
    expect(j.getProductStock(CHURRASCO.id)).toBe(8);
    expect(j.getProductStock(PAO.id)).toBe(3);
    j.restoreOrderItemsToStock([{ productId: CACHORRO.id, qty: 2 }]);
    expect(j.getProductStock(CHURRASCO.id)).toBe(10);
    expect(j.getProductStock(PAO.id)).toBe(5);
  });

  it("com useStock desligado nao debita insumos (toggle de operacao)", async () => {
    j.state.config.useStock = false;
    seedOrders(j, [makeOrder({ id: "o1", items: [] })]);
    j.state.selectedOrderId = "o1";
    await j.addItemToOrder(CACHORRO.id);
    expect(j.getProductStock(CHURRASCO.id)).toBe(10);
    expect(j.getProductStock(PAO.id)).toBe(5);
  });

  it("produto normal continua debitando apenas a si", async () => {
    seedProducts(j, [CHURRASCO, PAO, CACHORRO, PRODUCT_A, PRODUCT_B]);
    seedOrders(j, [makeOrder({ id: "o1", items: [] })]);
    j.state.selectedOrderId = "o1";
    await j.addItemToOrder(PRODUCT_A.id);
    expect(j.getProductStock(PRODUCT_A.id)).toBe(19);
    expect(j.getProductStock(PRODUCT_B.id)).toBe(5);
  });
});

describe("changeItemQty com item especial", () => {
  let j;

  const cachorroLine = {
    lineId: "line-cq-1",
    productId: CACHORRO.id,
    name: CACHORRO.name,
    price: CACHORRO.price,
    qty: 1,
    requiresPrep: true,
    requestedAt: "2026-05-15T19:00:00.000Z",
    deliveredAt: null,
    serviceSeconds: null,
    prepStatus: "Aguardando"
  };

  beforeEach(() => {
    j = loadJana();
    seedProducts(j, [CHURRASCO, PAO, CACHORRO]);
    attachSupabaseMock(j, createSupabaseMock());
  });

  it("incrementa qty e debita todos os insumos", () => {
    const order = makeOrder({ id: "o1", items: [{ ...cachorroLine }] });
    seedOrders(j, [order]);
    j.state.selectedOrderId = order.id;

    j.changeItemQty(0, 1);

    expect(j.getCurrentOrder().items[0].qty).toBe(2);
    expect(j.getProductStock(CHURRASCO.id)).toBe(9);
    expect(j.getProductStock(PAO.id)).toBe(4);
    expect(j.getProductStock(CACHORRO.id)).toBe(0);
  });

  it("reduz qty e devolve insumos; remove linha ao zerar", () => {
    const order = makeOrder({
      id: "o1",
      items: [{ ...cachorroLine, qty: 2 }]
    });
    seedOrders(j, [order]);
    j.state.selectedOrderId = order.id;
    j.setProductStockLocal(CHURRASCO.id, 8);
    j.setProductStockLocal(PAO.id, 3);

    j.changeItemQty(0, -1);
    expect(j.getCurrentOrder().items[0].qty).toBe(1);
    expect(j.getProductStock(CHURRASCO.id)).toBe(9);
    expect(j.getProductStock(PAO.id)).toBe(4);

    j.changeItemQty(0, -1);
    expect(j.getCurrentOrder().items).toHaveLength(0);
    expect(j.getProductStock(CHURRASCO.id)).toBe(10);
    expect(j.getProductStock(PAO.id)).toBe(5);
  });
});
