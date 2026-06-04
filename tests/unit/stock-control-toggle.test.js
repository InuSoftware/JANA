import { describe, it, expect, beforeEach } from "vitest";
import { loadJana, seedProducts, seedOrders, attachSupabaseMock } from "../helpers/load-jana.js";
import { createSupabaseMock } from "../helpers/supabase-mock.js";
import { PRODUCT_A, makeOrder } from "../helpers/fixtures.js";

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

describe("useStock (controle de estoque)", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
    seedProducts(j, [PRODUCT_A]);
  });

  it("isStockControlEnabled: true por padrao e quando useStock true", () => {
    expect(j.isStockControlEnabled()).toBe(true);
    j.state.config.useStock = true;
    expect(j.isStockControlEnabled()).toBe(true);
  });

  it("isStockControlEnabled: false quando useStock desligado", () => {
    j.state.config.useStock = false;
    expect(j.isStockControlEnabled()).toBe(false);
  });

  it("applyStockDeltaSilently nao altera estoque com controle desligado", () => {
    j.state.config.useStock = false;
    const before = j.getProductStock(PRODUCT_A.id);
    j.applyStockDeltaSilently(PRODUCT_A.id, -5);
    expect(j.getProductStock(PRODUCT_A.id)).toBe(before);
  });

  it("formatProductStockHintForCatalog retorna vazio sem controle", () => {
    j.state.config.useStock = false;
    expect(j.formatProductStockHintForCatalog(PRODUCT_A)).toBe("");
    j.state.config.useStock = true;
    expect(j.formatProductStockHintForCatalog(PRODUCT_A)).toContain("un.");
  });
});

describe("useStock na comanda", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
    seedProducts(j, [PRODUCT_A, CHURRASCO, PAO, CACHORRO]);
    attachSupabaseMock(j, createSupabaseMock());
    j.state.config.useStock = false;
  });

  it("addItemToOrder adiciona item sem debitar estoque", async () => {
    seedOrders(j, [makeOrder({ id: "o1", items: [] })]);
    j.state.selectedOrderId = "o1";
    await j.addItemToOrder(PRODUCT_A.id);
    expect(j.loadOrders()[0].items).toHaveLength(1);
    expect(j.getProductStock(PRODUCT_A.id)).toBe(20);
  });

  it("addItemToOrder em item especial nao debita insumos", async () => {
    seedOrders(j, [makeOrder({ id: "o1", items: [] })]);
    j.state.selectedOrderId = "o1";
    await j.addItemToOrder(CACHORRO.id);
    expect(j.loadOrders()[0].items[0].productId).toBe(CACHORRO.id);
    expect(j.getProductStock(CHURRASCO.id)).toBe(10);
    expect(j.getProductStock(PAO.id)).toBe(5);
  });

  it("changeItemQty nao altera estoque ao incrementar ou remover", () => {
    const order = makeOrder({
      id: "o1",
      items: [{ productId: PRODUCT_A.id, name: "A", price: 10, qty: 1, requiresPrep: false }]
    });
    seedOrders(j, [order]);
    j.state.selectedOrderId = order.id;

    j.changeItemQty(0, 1);
    expect(j.getCurrentOrder().items[0].qty).toBe(2);
    expect(j.getProductStock(PRODUCT_A.id)).toBe(20);

    j.changeItemQty(0, -1);
    j.changeItemQty(0, -1);
    expect(j.getCurrentOrder().items).toHaveLength(0);
    expect(j.getProductStock(PRODUCT_A.id)).toBe(20);
  });

  it("restoreOrderItemsToStock nao devolve com controle desligado", () => {
    j.applyOrderLineStockDelta(CACHORRO, -2);
    expect(j.getProductStock(CHURRASCO.id)).toBe(10);
    j.restoreOrderItemsToStock([{ productId: CACHORRO.id, qty: 2 }]);
    expect(j.getProductStock(CHURRASCO.id)).toBe(10);
    expect(j.getProductStock(PAO.id)).toBe(5);
  });

  it("applyOrderLineStockDelta e no-op com controle desligado", () => {
    j.applyOrderLineStockDelta(CACHORRO, -3);
    expect(j.getProductStock(CHURRASCO.id)).toBe(10);
    expect(j.getProductStock(PAO.id)).toBe(5);
  });
});

describe("readProductSpecialFromForm com estoque desligado", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
    seedProducts(j, [CHURRASCO, PAO, CACHORRO]);
    j.state.config.useStock = false;
    j.refs.productIdInput.value = CACHORRO.id;
    j.refs.productSpecialInput.checked = false;
  });

  it("preserva configuracao do produto em edicao (nao apaga no salvar)", () => {
    const special = j.readProductSpecialFromForm();
    expect(special.isSpecial).toBe(true);
    expect(special.stockComponentIds).toEqual([CHURRASCO.id, PAO.id]);
    expect(special.stockDisplayProductId).toBe(PAO.id);
  });

  it("produto novo continua sem item especial", () => {
    j.refs.productIdInput.value = "";
    const special = j.readProductSpecialFromForm();
    expect(special.isSpecial).toBe(false);
    expect(special.stockComponentIds).toEqual([]);
  });

  it("regressao: atualizar nome com estoque off nao apaga item especial (fluxo do Salvar)", () => {
    j.refs.productIdInput.value = CACHORRO.id;
    j.refs.productSpecialInput.checked = false;

    const products = j.loadProducts();
    const target = products.find((p) => String(p.id) === String(CACHORRO.id));
    const special = j.readProductSpecialFromForm();
    const productData = {
      name: "Cachorro-quente (teste renomeado)",
      category: target.category,
      price: target.price,
      requiresPrep: target.requiresPrep,
      isSpecial: special.isSpecial,
      stockComponentIds: special.stockComponentIds,
      stockDisplayProductId: special.stockDisplayProductId
    };

    target.name = productData.name;
    target.isSpecial = productData.isSpecial;
    target.stockComponentIds = productData.stockComponentIds;
    target.stockDisplayProductId = productData.stockDisplayProductId;

    expect(target.isSpecial).toBe(true);
    expect(target.stockComponentIds).toEqual([CHURRASCO.id, PAO.id]);
    expect(target.stockDisplayProductId).toBe(PAO.id);
    expect(j.productToRow(target).is_special).toBe(true);
    expect(j.productToRow(target).stock_component_ids).toEqual([CHURRASCO.id, PAO.id]);
  });
});

describe("useStock ao religar controle", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
    seedProducts(j, [PRODUCT_A]);
    attachSupabaseMock(j, createSupabaseMock());
  });

  it("vendas com estoque off e depois on: so novas adicoes debitam", async () => {
    seedOrders(j, [makeOrder({ id: "o1", items: [] })]);
    j.state.selectedOrderId = "o1";

    j.state.config.useStock = false;
    await j.addItemToOrder(PRODUCT_A.id);
    expect(j.getProductStock(PRODUCT_A.id)).toBe(20);

    j.state.config.useStock = true;
    await j.addItemToOrder(PRODUCT_A.id);
    expect(j.getProductStock(PRODUCT_A.id)).toBe(19);
    expect(j.loadOrders()[0].items[0].qty).toBe(2);
  });
});
