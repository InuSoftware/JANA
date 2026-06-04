import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadJana, seedOrders, seedShifts, attachSupabaseMock } from "../helpers/load-jana.js";
import { createSupabaseMock } from "../helpers/supabase-mock.js";
import { makeDailyCloseRow, makeFinalizedOrder, makeShift } from "../helpers/fixtures.js";

describe("shiftRowToApp", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: mapeia colunas snake_case", () => {
    const app = j.shiftRowToApp({
      id: "s1",
      reference_date: "2026-05-15",
      scheduled_start: "18:00:00",
      scheduled_end: "02:00:00",
      window_start_at: "2026-05-15T18:00:00Z",
      window_end_at: "2026-05-16T02:00:00Z",
      started_at: "2026-05-15T18:00:00Z",
      ended_at: null,
      status: "aberto",
      payload: { x: 1 }
    });
    expect(app.referenceDate).toBe("2026-05-15");
    expect(app.scheduledStart).toBe("18:00");
    expect(app.status).toBe("aberto");
    expect(app.payload.x).toBe(1);
  });

  it("fronteiras: status desconhecido vira aberto", () => {
    expect(j.shiftRowToApp({ id: "s", status: "x" }).status).toBe("aberto");
  });

  it("invariantes: referenceDate max 10 chars", () => {
    const app = j.shiftRowToApp({ id: "s", reference_date: "2026-05-15T00:00:00+00" });
    expect(app.referenceDate).toHaveLength(10);
  });
});

describe("isLegacyAutoOpenShift", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: turno legado 18:00-02:00 sem snapshot", () => {
    const shift = makeShift({ scheduledStart: "18:00", scheduledEnd: "02:00", payload: {} });
    expect(j.isLegacyAutoOpenShift(shift)).toBe(true);
  });

  it("fronteiras: fechado, horários diferentes, com snapshot", () => {
    expect(j.isLegacyAutoOpenShift(makeShift({ status: "fechado" }))).toBe(false);
    expect(j.isLegacyAutoOpenShift(makeShift({ scheduledStart: "10:00" }))).toBe(false);
    expect(
      j.isLegacyAutoOpenShift(makeShift({ payload: { closeSnapshot: { totalBruto: 0 } } }))
    ).toBe(false);
  });

  it("entradas inválidas: null", () => {
    expect(j.isLegacyAutoOpenShift(null)).toBe(false);
  });
});

describe("shiftHasRegisterActivity", () => {
  let j;
  const shift = makeShift({ startedAt: "2026-05-15T18:00:00.000Z" });

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: finalizada no turno", () => {
    const orders = [makeFinalizedOrder({ closedAt: "2026-05-15T19:00:00.000Z" })];
    expect(j.shiftHasRegisterActivity(shift, orders)).toBe(true);
  });

  it("fronteiras: comanda aberta criada após abertura", () => {
    const orders = [{ status: "Aberta", createdAt: "2026-05-15T19:00:00.000Z" }];
    expect(j.shiftHasRegisterActivity(shift, orders)).toBe(true);
  });

  it("entradas inválidas: shift null", () => {
    expect(j.shiftHasRegisterActivity(null, [])).toBe(false);
  });
});

describe("shouldInferOpenShiftFromOpenOrders", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: comandas abertas sem caixa aberto", () => {
    seedOrders(j, [{ status: "Aberta", createdAt: "2026-05-15T18:00:00.000Z" }]);
    expect(j.shouldInferOpenShiftFromOpenOrders(j.loadOrders())).toBe(true);
  });

  it("fronteiras: caixa aberto impede inferência", () => {
    seedShifts(j, [makeShift({ status: "aberto" })]);
    seedOrders(j, [{ status: "Aberta", createdAt: "2026-05-15T18:00:00.000Z" }]);
    expect(j.shouldInferOpenShiftFromOpenOrders(j.loadOrders())).toBe(false);
  });

  it("fronteiras: sem comandas abertas", () => {
    expect(j.shouldInferOpenShiftFromOpenOrders([])).toBe(false);
  });
});

describe("dailyCloseRowToShiftLike / isDuplicateOfShift", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: converte fechamento legado", () => {
    const row = makeDailyCloseRow();
    const shiftLike = j.dailyCloseRowToShiftLike(row);
    expect(shiftLike.status).toBe("fechado");
    expect(shiftLike.referenceDate).toBe("2026-05-10");
    expect(shiftLike.payload.legacyDailyClose).toBe(true);
  });

  it("happy path: detecta duplicata por ref e horário", () => {
    const daily = { id: "d1", dateYmd: "2026-05-10", closedAt: "2026-05-10T23:30:00.000Z" };
    const shift = makeShift({
      id: "d1",
      referenceDate: "2026-05-10",
      endedAt: "2026-05-10T23:31:00.000Z",
      status: "fechado"
    });
    expect(j.isDuplicateOfShift(daily, shift)).toBe(true);
  });

  it("fronteiras: refs diferentes não duplicam", () => {
    expect(
      j.isDuplicateOfShift(
        { dateYmd: "2026-05-10", closedAt: "2026-05-10T23:00:00.000Z" },
        makeShift({ referenceDate: "2026-05-11", endedAt: "2026-05-11T23:00:00.000Z", status: "fechado" })
      )
    ).toBe(false);
  });
});

describe("loadAllClosedSessions / loadClosedShiftsFiltered", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
    seedShifts(j, [
      makeShift({ id: "s1", status: "fechado", referenceDate: "2026-05-15", endedAt: "2026-05-15T23:00:00.000Z" })
    ]);
    j.state.cache.dailyCloses = [makeDailyCloseRow({ dateYmd: "2026-05-10" })];
  });

  it("happy path: merge shifts + legacy sem duplicar", () => {
    const all = j.loadAllClosedSessions();
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all[0].referenceDate >= all[all.length - 1].referenceDate).toBe(true);
  });

  it("fronteiras: filtro por intervalo", () => {
    const filtered = j.loadClosedShiftsFiltered("2026-05-15", "2026-05-20");
    expect(filtered.every((s) => s.referenceDate >= "2026-05-15" && s.referenceDate <= "2026-05-20")).toBe(true);
  });

  it("invariantes: todos fechados", () => {
    expect(j.loadAllClosedSessions().every((s) => s.status === "fechado")).toBe(true);
  });
});

describe("getOpenShift / getLastClosedShift / canUndoLastShiftClose", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: identifica aberto e último fechado", () => {
    seedShifts(j, [
      makeShift({ id: "open", status: "aberto" }),
      makeShift({
        id: "c1",
        status: "fechado",
        endedAt: "2026-05-14T23:00:00.000Z",
        referenceDate: "2026-05-14"
      }),
      makeShift({
        id: "c2",
        status: "fechado",
        endedAt: "2026-05-15T23:00:00.000Z",
        referenceDate: "2026-05-15"
      })
    ]);
    expect(j.getOpenShift()?.id).toBe("open");
    expect(j.getLastClosedShift()?.id).toBe("c2");
    expect(j.canUndoLastShiftClose()).toBe(false);
  });

  it("fronteiras: sem caixas", () => {
    expect(j.getOpenShift()).toBeNull();
    expect(j.getLastClosedShift()).toBeNull();
    expect(j.canUndoLastShiftClose()).toBe(false);
  });

  it("estado: com caixa fechado e nenhum aberto permite undo", () => {
    seedShifts(j, [
      makeShift({ id: "c2", status: "fechado", endedAt: "2026-05-15T23:00:00.000Z" })
    ]);
    expect(j.canUndoLastShiftClose()).toBe(true);
  });
});

describe("undoLastShiftCloseHint", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: mensagem com referência", () => {
    seedShifts(j, [
      makeShift({
        status: "fechado",
        referenceDate: "2026-05-15",
        endedAt: "2026-05-15T23:00:00.000Z"
      })
    ]);
    expect(j.undoLastShiftCloseHint()).toContain("15/05/2026");
  });

  it("fronteiras: caixa aberto bloqueia", () => {
    seedShifts(j, [makeShift({ status: "aberto" })]);
    expect(j.undoLastShiftCloseHint()).toContain("Feche o caixa aberto");
  });
});

describe("suggestReferenceDateForShift / getCashCloseReferenceDateForUi", () => {
  let j;
  const shift = makeShift({ id: "s-ui", referenceDate: "2026-05-01", startedAt: "2026-05-01T18:00:00.000Z" });

  beforeEach(() => {
    j = loadJana();
    seedOrders(j, [makeFinalizedOrder({ closedAt: "2026-05-15T20:00:00.000Z", shiftId: shift.id })]);
  });

  it("happy path: usa menor data de venda", () => {
    expect(j.suggestReferenceDateForShift(shift)).toBe("2026-05-15");
  });

  it("estado: UI cacheia por shift id", () => {
    const d1 = j.getCashCloseReferenceDateForUi(shift);
    j.state.cashCloseReferenceDateYmd = "2026-05-20";
    const d2 = j.getCashCloseReferenceDateForUi(shift);
    expect(d2).toBe("2026-05-20");
    expect(d1).toBe("2026-05-15");
  });

  it("fronteiras: shift null retorna hoje", () => {
    expect(j.getCashCloseReferenceDateForUi(null)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("openShiftManual", () => {
  it("happy path: insere turno via mock Supabase", async () => {
    const j = loadJana();
    attachSupabaseMock(
      j,
      createSupabaseMock({
        "shifts:single": {
          data: {
            id: "new-shift",
            reference_date: "2026-05-15",
            scheduled_start: "12:00:00",
            scheduled_end: "12:00:00",
            window_start_at: "2026-05-15T12:00:00.000Z",
            window_end_at: "2026-05-15T12:00:00.000Z",
            started_at: "2026-05-15T12:00:00.000Z",
            ended_at: null,
            status: "aberto",
            payload: {}
          },
          error: null
        }
      })
    );

    const created = await j.openShiftManual();
    expect(created.status).toBe("aberto");
    expect(j.getOpenShift()?.id).toBe("new-shift");
  });

  it("entradas inválidas: caixa aberto lança erro", async () => {
    const j = loadJana();
    seedShifts(j, [makeShift({ status: "aberto" })]);
    attachSupabaseMock(j, createSupabaseMock());
    await expect(j.openShiftManual()).rejects.toThrow(/Ja existe um caixa aberto/);
  });
});

describe("rollbackLastClosedShift", () => {
  it("happy path: reabre último fechado", async () => {
    const j = loadJana();
    seedShifts(j, [
      makeShift({ id: "last", status: "fechado", endedAt: "2026-05-15T23:00:00.000Z", referenceDate: "2026-05-15" })
    ]);
    const mock = createSupabaseMock({
      "shifts:single": {
        data: {
          id: "last",
          reference_date: "2026-05-15",
          scheduled_start: "18:00",
          scheduled_end: "23:00",
          window_start_at: "2026-05-15T18:00:00.000Z",
          window_end_at: "2026-05-15T23:00:00.000Z",
          started_at: "2026-05-15T18:00:00.000Z",
          ended_at: null,
          status: "aberto",
          payload: {}
        },
        error: null
      }
    });
    attachSupabaseMock(
      j,
      createSupabaseMock({
        "shifts:single": {
          data: {
            id: "last",
            reference_date: "2026-05-15",
            scheduled_start: "18:00",
            scheduled_end: "23:00",
            window_start_at: "2026-05-15T18:00:00.000Z",
            window_end_at: "2026-05-15T23:00:00.000Z",
            started_at: "2026-05-15T18:00:00.000Z",
            ended_at: null,
            status: "aberto",
            payload: {}
          },
          error: null
        }
      })
    );
    expect(await j.rollbackLastClosedShift()).toBe(true);
    expect(j.getOpenShift()?.id).toBe("last");
  });

  it("entradas inválidas: caixa aberto lança erro", async () => {
    const j = loadJana();
    seedShifts(j, [
      makeShift({ status: "aberto" }),
      makeShift({ id: "last", status: "fechado", endedAt: "2026-05-15T23:00:00.000Z" })
    ]);
    attachSupabaseMock(j, createSupabaseMock());
    await expect(j.rollbackLastClosedShift()).rejects.toThrow(/Feche o caixa aberto/);
  });
});

describe("ordersForDashboard", () => {
  let j;
  const shift = makeShift();

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: abertas + finalizadas do turno sem duplicar", () => {
    const open = makeShift({ id: "x" });
    seedShifts(j, [shift]);
    const orders = [
      { id: "1", status: "Aberta" },
      makeFinalizedOrder({ id: "2", closedAt: "2026-05-15T19:00:00.000Z" }),
      makeFinalizedOrder({ id: "3", closedAt: "2026-01-01T12:00:00.000Z" })
    ];
    const dash = j.ordersForDashboard(orders, shift);
    expect(dash.map((o) => o.id).sort()).toEqual(["1", "2"]);
  });

  it("fronteiras: sem shift retorna só abertas", () => {
    const orders = [makeFinalizedOrder(), { id: "a", status: "Aberta" }];
    expect(j.ordersForDashboard(orders, null).map((o) => o.id)).toEqual(["a"]);
  });
});
