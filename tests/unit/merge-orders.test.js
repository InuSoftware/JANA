import { describe, it, expect, beforeEach } from "vitest";
import { loadJana, seedOrders } from "../helpers/load-jana.js";
import { makeOrder } from "../helpers/fixtures.js";

describe("merge orders (juntar comandas)", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("getCheckoutCombinedItems soma itens da principal e juntadas", () => {
    seedOrders(j, [
      makeOrder({
        id: "p1",
        customer: "Pai",
        items: [{ productId: "a", name: "Cerveja", price: 10, qty: 2 }],
      }),
      makeOrder({
        id: "f1",
        customer: "Filha",
        items: [{ productId: "b", name: "Suco", price: 8, qty: 1 }],
      }),
    ]);
    j.state.selectedOrderId = "p1";
    j.addMergedOrderId("f1");
    expect(j.getCheckoutCombinedItems()).toHaveLength(2);
    expect(j.calculateCheckoutSubtotal()).toBe(28);
  });

  it("mergeItemsIntoOrder une quantidades do mesmo produto", () => {
    const target = makeOrder({
      items: [{ lineId: "l1", productId: "a", name: "Cerveja", price: 10, qty: 1 }],
    });
    const source = makeOrder({
      items: [{ lineId: "l2", productId: "a", name: "Cerveja", price: 10, qty: 2 }],
    });
    j.mergeItemsIntoOrder(target, source);
    expect(target.items).toHaveLength(1);
    expect(target.items[0].qty).toBe(3);
  });

  it("getMergeableOpenOrders exclui principal e ja juntadas", () => {
    seedOrders(j, [
      makeOrder({ id: "p1", items: [{ price: 1, qty: 1 }] }),
      makeOrder({ id: "f1", items: [{ price: 1, qty: 1 }] }),
      makeOrder({ id: "f2", items: [{ price: 1, qty: 1 }] }),
    ]);
    j.state.selectedOrderId = "p1";
    j.addMergedOrderId("f1");
    const mergeable = j.getMergeableOpenOrders();
    expect(mergeable.map((o) => o.id)).toEqual(["f2"]);
  });
});
