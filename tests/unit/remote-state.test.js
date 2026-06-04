import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadJana, seedProducts, attachSupabaseMock } from "../helpers/load-jana.js";
import { createSupabaseMock } from "../helpers/supabase-mock.js";
import { PRODUCT_A, makeFinalizedOrder, makeOrder } from "../helpers/fixtures.js";

describe("upsertProductRemote", () => {
  it("happy path: chama upsert na tabela products", async () => {
    const j = loadJana();
    const mock = attachSupabaseMock(j, createSupabaseMock());
    await j.upsertProductRemote(PRODUCT_A);
    expect(mock.from).toHaveBeenCalledWith("products");
  });

  it("fronteiras: sem supabase retorna cedo", async () => {
    const j = loadJana();
    window.__SUPABASE_URL__ = "";
    j.resetSupabaseClientForTests();
    await expect(j.upsertProductRemote(PRODUCT_A)).resolves.toBeUndefined();
    window.__SUPABASE_URL__ = "https://example.supabase.co";
  });

  it("entradas inválidas: erro do banco propaga", async () => {
    const j = loadJana();
    const mock = createSupabaseMock();
    mock.from.mockImplementation(() => ({
      upsert: () => ({
        then(onFulfilled) {
          return Promise.resolve({ error: { message: "fail" } }).then(onFulfilled);
        }
      })
    }));
    attachSupabaseMock(j, mock);
    await expect(j.upsertProductRemote(PRODUCT_A)).rejects.toEqual({ message: "fail" });
  });
});

describe("adjustProductStockRemote / setProductStockRemote", () => {
  it("happy path: chama RPC com inteiros", async () => {
    const j = loadJana();
    const mock = attachSupabaseMock(j, createSupabaseMock());
    await j.adjustProductStockRemote(PRODUCT_A.id, -2.7);
    await j.setProductStockRemote(PRODUCT_A.id, 10.2);
    expect(mock.rpc).toHaveBeenCalledWith("adjust_product_stock", {
      p_product_id: String(PRODUCT_A.id),
      p_delta: -2
    });
    expect(mock.rpc).toHaveBeenCalledWith("set_product_stock", {
      p_product_id: String(PRODUCT_A.id),
      p_quantity: 10
    });
  });
});

describe("upsertCommandaRemote", () => {
  it("happy path: monta row com payload sem id", async () => {
    const j = loadJana();
    const mock = attachSupabaseMock(j, createSupabaseMock());
    const order = makeFinalizedOrder({ id: "cmd-1" });
    await j.upsertCommandaRemote(order);
    expect(mock.from).toHaveBeenCalledWith("commandas");
  });

  it("fronteiras: createdAt inválido usa now (mock não valida ISO)", async () => {
    const j = loadJana();
    attachSupabaseMock(j, createSupabaseMock());
    await expect(j.upsertCommandaRemote(makeOrder({ createdAt: "invalido" }))).resolves.toBeUndefined();
  });
});

describe("ensureProfile", () => {
  it("happy path: não insere se perfil existe", async () => {
    const j = loadJana();
    const mock = createSupabaseMock({
      "profiles:maybeSingle": { data: { id: "u1" }, error: null }
    });
    const insert = vi.fn();
    mock.from.mockImplementation((table) => {
      const api = createSupabaseMock()[table] || createSupabaseMock().from("x");
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "u1" }, error: null })
            })
          }),
          insert
        };
      }
      return api;
    });
    await j.ensureProfile({ user: { id: "u1", email: "a@b.com" } }, mock);
    expect(insert).not.toHaveBeenCalled();
  });

  it("happy path: insere perfil Gerente quando ausente", async () => {
    const j = loadJana();
    const insert = vi.fn(() => ({ error: null }));
    const mock = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null })
          })
        }),
        insert
      }))
    };
    await j.ensureProfile({ user: { id: "u2", email: "gerente@loja.com" } }, mock);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u2", role: "Gerente" })
    );
  });
});

describe("deleteProductRemote / deleteCommandaRemote / deleteDailyCloseRemote", () => {
  it("happy path: delete com eq id", async () => {
    const j = loadJana();
    const mock = attachSupabaseMock(j, createSupabaseMock());
    await j.deleteProductRemote(PRODUCT_A.id);
    await j.deleteCommandaRemote("order-1");
    await j.deleteDailyCloseRemote("close-1");
    expect(mock.from).toHaveBeenCalledWith("products");
    expect(mock.from).toHaveBeenCalledWith("commandas");
    expect(mock.from).toHaveBeenCalledWith("daily_closes");
  });
});

describe("insertShiftRemote / closeShiftRemote / reopenShiftRemote", () => {
  it("happy path: closeShiftRemote grava snapshot", async () => {
    const j = loadJana();
    const shift = {
      id: "s1",
      referenceDate: "2026-05-15",
      startedAt: "2026-05-15T18:00:00.000Z",
      status: "aberto",
      payload: {}
    };
    attachSupabaseMock(
      j,
      createSupabaseMock({
        "shifts:single": {
          data: {
            id: "s1",
            reference_date: "2026-05-15",
            scheduled_start: "18:00",
            scheduled_end: "23:00",
            window_start_at: "2026-05-15T18:00:00.000Z",
            window_end_at: "2026-05-15T23:00:00.000Z",
            started_at: "2026-05-15T18:00:00.000Z",
            ended_at: "2026-05-15T23:00:00.000Z",
            status: "fechado",
            payload: { closeSnapshot: { totalBruto: 0 } }
          },
          error: null
        }
      })
    );
    const closed = await j.closeShiftRemote(shift, { totalBruto: 100, finalizedOrdersCount: 2, sales: [] }, "2026-05-15");
    expect(closed.status).toBe("fechado");
  });

  it("entradas inválidas: sem supabase lança", async () => {
    const j = loadJana();
    window.__SUPABASE_URL__ = "";
    j.resetSupabaseClientForTests();
    await expect(j.insertShiftRemote({})).rejects.toThrow(/Supabase indisponivel/);
    window.__SUPABASE_URL__ = "https://example.supabase.co";
  });
});

describe("saveProducts / saveOrders (estado local + fire-and-forget remoto)", () => {
  it("happy path: atualiza cache local", () => {
    const j = loadJana();
    window.__SUPABASE_URL__ = "";
    j.resetSupabaseClientForTests();
    j.saveProducts([PRODUCT_A]);
    expect(j.loadProducts()).toHaveLength(1);
    j.saveOrders([makeOrder()]);
    expect(j.loadOrders()).toHaveLength(1);
  });

  it("estado: segunda gravação substitui cache", () => {
    const j = loadJana();
    j.getSupabase = async () => null;
    j.saveProducts([PRODUCT_A]);
    j.saveProducts([]);
    expect(j.loadProducts()).toEqual([]);
  });
});

describe("clearDataCache", () => {
  it("happy path: zera caches", () => {
    const j = loadJana();
    seedProducts(j, [PRODUCT_A]);
    j.state.cache.commandas = [makeOrder()];
    j.clearDataCache();
    expect(j.loadProducts()).toEqual([]);
    expect(j.loadOrders()).toEqual([]);
    expect(j.loadShifts()).toEqual([]);
  });

  it("invariantes: config volta ao default", () => {
    const j = loadJana();
    j.state.cache.config.useTables = true;
    j.clearDataCache();
    expect(j.loadConfig().useTables).toBe(false);
  });
});

describe("loadConfig / saveConfig", () => {
  it("happy path: merge com fallback", () => {
    const j = loadJana();
    j.state.cache.config = { useTables: true, categories: ["X"] };
    const cfg = j.loadConfig();
    expect(cfg.useTables).toBe(true);
    expect(cfg.categories).toEqual(["X"]);
  });

  it("fronteiras: tema inválido cai no default", () => {
    const j = loadJana();
    j.state.cache.config.activeTheme = "tema-inexistente";
    expect(j.loadConfig().activeTheme).toBe("blue-service");
  });

  it("estado: saveConfig persiste no cache", () => {
    const j = loadJana();
    window.__SUPABASE_URL__ = "";
    j.resetSupabaseClientForTests();
    const cfg = j.loadConfig();
    cfg.useTables = true;
    j.saveConfig(cfg);
    expect(j.state.cache.config.useTables).toBe(true);
  });
});
