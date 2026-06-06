import { describe, it, expect, beforeEach } from "vitest";
import { loadJana } from "../helpers/load-jana.js";

describe("split bill (acerto)", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("initSplitBillAssignments cria matriz zerada", () => {
    const rows = j.initSplitBillAssignments(
      [{ qty: 3 }, { qty: 2 }],
      2,
    );
    expect(rows).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  it("adjustSplitBillQty respeita quantidade do item", () => {
    const rows = j.initSplitBillAssignments([{ qty: 3 }], 2);
    let next = j.adjustSplitBillQty(rows, 0, 0, 2, 3);
    expect(next[0]).toEqual([2, 0]);
    next = j.adjustSplitBillQty(next, 0, 1, 5, 3);
    expect(next[0]).toEqual([2, 1]);
    next = j.adjustSplitBillQty(next, 0, 0, -1, 3);
    expect(next[0]).toEqual([1, 1]);
  });

  it("computeSplitBillResult calcula totais por pessoa e taxa", () => {
    const items = [
      { name: "Cerveja", price: 10, qty: 3 },
      { name: "Agua", price: 5, qty: 2 },
    ];
    const assignments = [
      [2, 1],
      [1, 1],
    ];
    const result = j.computeSplitBillResult(items, assignments, 2, 10);
    expect(result.personSubtotals).toEqual([25, 15]);
    expect(result.personTotals[0]).toBeCloseTo(27.5, 5);
    expect(result.personTotals[1]).toBeCloseTo(16.5, 5);
    expect(result.unassignedSubtotal).toBe(0);
    expect(result.orderSubtotal).toBe(40);
    expect(result.orderTotal).toBeCloseTo(44, 5);
  });

  it("computeSplitBillResult mostra valor nao atribuido", () => {
    const items = [{ name: "Cerveja", price: 8, qty: 4 }];
    const assignments = [[2, 1]];
    const result = j.computeSplitBillResult(items, assignments, 2, 0);
    expect(result.unassignedSubtotal).toBe(8);
    expect(result.personSubtotals).toEqual([16, 8]);
  });

  it("resizeSplitBillAssignments reduz pessoas sem ultrapassar qty", () => {
    const items = [{ name: "Cerveja", price: 8, qty: 3 }];
    const assignments = [[2, 1, 0]];
    const next = j.resizeSplitBillAssignments(assignments, items, 2);
    expect(next[0]).toEqual([2, 1]);
  });

  it("renderCheckoutSplitBillSummary mostra totais confirmados", () => {
    const order = {
      id: "o1",
      items: [{ name: "Cerveja", price: 10, qty: 2 }],
    };
    j.state.splitBillConfirmed = {
      orderId: "o1",
      personCount: 2,
      assignments: [[1, 1]],
    };
    const html = j.renderCheckoutSplitBillSummary(order, 0);
    expect(html).toContain("Acerto entre pessoas");
    expect(html).toContain("Pessoa 1");
    expect(html).toContain("Pessoa 2");
    expect(html).toContain("R$");
  });
});
