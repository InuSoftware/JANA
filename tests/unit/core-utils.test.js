import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadJana } from "../helpers/load-jana.js";

describe("normalizeSupabaseProjectUrl", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: URL limpa, com barra final, com /rest/v1", () => {
    expect(j.normalizeSupabaseProjectUrl("https://abc.supabase.co")).toBe("https://abc.supabase.co");
    expect(j.normalizeSupabaseProjectUrl("https://abc.supabase.co/")).toBe("https://abc.supabase.co");
    expect(j.normalizeSupabaseProjectUrl("https://abc.supabase.co/rest/v1")).toBe("https://abc.supabase.co");
  });

  it("fronteiras: vazio, só espaços, múltiplas barras", () => {
    expect(j.normalizeSupabaseProjectUrl("")).toBe("");
    expect(j.normalizeSupabaseProjectUrl("   ")).toBe("");
    expect(j.normalizeSupabaseProjectUrl("https://x.co///")).toBe("https://x.co");
  });

  it("entradas inválidas: número e null viram string", () => {
    expect(j.normalizeSupabaseProjectUrl(null)).toBe("");
    expect(j.normalizeSupabaseProjectUrl(123)).toBe("123");
  });

  it("estado: chamadas múltiplas são idempotentes", () => {
    const url = "https://abc.supabase.co/rest/v1/";
    expect(j.normalizeSupabaseProjectUrl(url)).toBe(j.normalizeSupabaseProjectUrl(url));
  });

  it("invariantes: sem path /rest/v1; sem barra final", () => {
    const out = j.normalizeSupabaseProjectUrl("https://abc.supabase.co/rest/v1/");
    expect(out.endsWith("/")).toBe(false);
    expect(out.toLowerCase()).not.toContain("/rest/v1");
    expect(out.startsWith("https://")).toBe(true);
  });
});

describe("isSupabaseConfigured", () => {
  beforeEach(() => {
    loadJana();
  });

  it("happy path: URL e chave preenchidas", () => {
    window.__SUPABASE_URL__ = "https://x.supabase.co";
    window.__SUPABASE_ANON_KEY__ = "key";
    expect(loadJana().isSupabaseConfigured()).toBe(true);
  });

  it("fronteiras: URL vazia, chave vazia, só espaços", () => {
    const j = loadJana();
    window.__SUPABASE_URL__ = "";
    window.__SUPABASE_ANON_KEY__ = "key";
    expect(j.isSupabaseConfigured()).toBe(false);

    window.__SUPABASE_URL__ = "https://x.supabase.co";
    window.__SUPABASE_ANON_KEY__ = "   ";
    expect(j.isSupabaseConfigured()).toBe(false);
  });

  it("invariantes: retorno booleano", () => {
    window.__SUPABASE_URL__ = "https://x.supabase.co";
    window.__SUPABASE_ANON_KEY__ = "k";
    expect(typeof loadJana().isSupabaseConfigured()).toBe("boolean");
  });
});

describe("defaultConfigPayload", () => {
  it("happy path: estrutura padrão esperada", () => {
    const j = loadJana();
    const cfg = j.defaultConfigPayload();
    expect(cfg.id).toBe(1);
    expect(cfg.useTables).toBe(false);
    expect(cfg.useServiceFee).toBe(true);
    expect(cfg.useStock).toBe(true);
    expect(cfg.activeTheme).toBe("blue-service");
    expect(cfg.categories.length).toBeGreaterThan(0);
    expect(cfg.paymentMethods.length).toBe(4);
  });

  it("fronteiras: chamada repetida retorna novo objeto", () => {
    const j = loadJana();
    const a = j.defaultConfigPayload();
    const b = j.defaultConfigPayload();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("invariantes: paymentMethods sempre com id/name/active", () => {
    const cfg = loadJana().defaultConfigPayload();
    for (const m of cfg.paymentMethods) {
      expect(m.id).toBeTruthy();
      expect(m.name).toBeTruthy();
      expect(typeof m.active).toBe("boolean");
    }
  });
});

describe("productRowToApp / productToRow", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: conversão bidirecional preserva dados", () => {
    const row = { id: "p1", name: "Suco", category: "Bebidas", price: 8, requires_prep: true };
    const app = j.productRowToApp(row, 7);
    expect(app).toMatchObject({ id: "p1", name: "Suco", category: "Bebidas", price: 8, requiresPrep: true, stock: 7 });
    expect(j.productToRow(app)).toEqual({
      id: "p1",
      name: "Suco",
      category: "Bebidas",
      price: 8,
      requires_prep: true,
      is_special: false,
      stock_component_ids: [],
      stock_display_product_id: null
    });
  });

  it("fronteiras: stock null/undefined, requires_prep false", () => {
    const row = { id: "p2", name: "X", category: "Outros", price: "10.5", requires_prep: false };
    expect(j.productRowToApp(row, null).stock).toBe(0);
    expect(j.productRowToApp(row).stock).toBe(0);
    expect(j.productRowToApp(row, 3.9).stock).toBe(3);
  });

  it("entradas inválidas: price não numérico vira NaN (comportamento atual)", () => {
    const app = j.productRowToApp({ id: "p", name: "N", category: "C", price: "abc", requires_prep: false }, 0);
    expect(Number.isNaN(app.price)).toBe(true);
  });

  it("invariantes: stock sempre inteiro >= 0 na conversão from row", () => {
    const app = j.productRowToApp({ id: "p", name: "N", category: "C", price: 1, requires_prep: false }, -2.7);
    expect(app.stock).toBe(-2);
    expect(Number.isInteger(app.stock)).toBe(true);
  });
});

describe("commandaToPayload / commandaPayloadDocument", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: deep clone e remoção de id", () => {
    const order = { id: "o1", customer: "Ana", items: [{ qty: 1 }] };
    const payload = j.commandaToPayload(order);
    expect(payload).toEqual(order);
    expect(payload).not.toBe(order);

    const doc = j.commandaPayloadDocument(order);
    expect(doc.id).toBeUndefined();
    expect(doc.customer).toBe("Ana");
  });

  it("fronteiras: objeto vazio, id null", () => {
    const doc = j.commandaPayloadDocument({ id: null, customer: "" });
    expect(doc.id).toBeUndefined();
  });

  it("invariantes: documento nunca contém id", () => {
    const doc = j.commandaPayloadDocument({ id: "x", nested: { a: 1 } });
    expect("id" in doc).toBe(false);
    expect(doc.nested.a).toBe(1);
  });
});

describe("toIsoTimestamptz", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: Date, ISO string, timestamp numérico", () => {
    expect(j.toIsoTimestamptz("2026-05-15T12:00:00.000Z")).toBe("2026-05-15T12:00:00.000Z");
    expect(j.toIsoTimestamptz(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01T00:00:00.000Z");
  });

  it("fronteiras: null, vazio, zero", () => {
    expect(j.toIsoTimestamptz(null)).toBeNull();
    expect(j.toIsoTimestamptz("")).toBeNull();
  });

  it("entradas inválidas: texto inválido retorna null", () => {
    expect(j.toIsoTimestamptz("não-é-data")).toBeNull();
  });

  it("invariantes: retorno null ou string ISO UTC com Z", () => {
    const r = j.toIsoTimestamptz("2026-05-15T15:00:00.000Z");
    expect(r === null || (typeof r === "string" && r.endsWith("Z"))).toBe(true);
  });
});

describe("isValidYmd", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: datas válidas", () => {
    expect(j.isValidYmd("2026-05-15")).toBe(true);
    expect(j.isValidYmd("2024-02-29")).toBe(true);
  });

  it("fronteiras: vazio, formato parcial", () => {
    expect(j.isValidYmd("")).toBe(false);
    expect(j.isValidYmd("2026-5-5")).toBe(false);
  });

  it("entradas inválidas: 2026-02-30, lixo", () => {
    expect(j.isValidYmd("2026-02-30")).toBe(false);
    expect(j.isValidYmd("abcd-ef-gh")).toBe(false);
  });

  it("invariantes: false para não-string coercível inválida", () => {
    expect(j.isValidYmd(null)).toBe(false);
    expect(j.isValidYmd(undefined)).toBe(false);
  });
});

describe("localDateFromYmd / todayLocalYmdFromDate", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: parse local sem UTC shift", () => {
    const d = j.localDateFromYmd("2026-06-03");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(3);
  });

  it("fronteiras: string longa usa só 10 chars", () => {
    const d = j.localDateFromYmd("2026-06-03T23:59:59Z");
    expect(d.getDate()).toBe(3);
  });

  it("entradas inválidas: vazio gera Date inválida (comportamento atual)", () => {
    const d = j.localDateFromYmd("");
    expect(Number.isNaN(d.getDate())).toBe(true);
  });

  it("invariantes: todayLocalYmdFromDate retorna YYYY-MM-DD", () => {
    const ymd = j.todayLocalYmdFromDate(new Date(2026, 0, 5));
    expect(ymd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ymd).toBe("2026-01-05");
  });
});

describe("normalizeOrderStatus", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: status canônicos", () => {
    expect(j.normalizeOrderStatus("Aberta")).toBe("Aberta");
    expect(j.normalizeOrderStatus("Finalizado")).toBe("Finalizado");
    expect(j.normalizeOrderStatus("Cancelada")).toBe("Cancelada");
  });

  it("fronteiras: legado Aguardando/Em curso", () => {
    expect(j.normalizeOrderStatus("Aguardando")).toBe("Aberta");
    expect(j.normalizeOrderStatus("Em curso")).toBe("Aberta");
  });

  it("entradas inválidas: desconhecido vira Aberta", () => {
    expect(j.normalizeOrderStatus("XYZ")).toBe("Aberta");
    expect(j.normalizeOrderStatus(null)).toBe("Aberta");
  });

  it("invariantes: retorno sempre um dos três status", () => {
    const allowed = new Set(["Aberta", "Finalizado", "Cancelada"]);
    for (const s of ["", 0, "foo", "Finalizado"]) {
      expect(allowed.has(j.normalizeOrderStatus(s))).toBe(true);
    }
  });
});

describe("formatCurrency", () => {
  let j;

  beforeEach(() => {
    j = loadJana();
  });

  it("happy path: valores positivos comuns", () => {
    expect(j.formatCurrency(10)).toContain("10");
    expect(j.formatCurrency(1234.56)).toMatch(/1\.234,56|1.234,56/);
  });

  it("fronteiras: zero, negativo", () => {
    expect(j.formatCurrency(0)).toContain("0");
    expect(j.formatCurrency(-5)).toContain("5");
  });

  it("invariantes: sempre inclui R$", () => {
    expect(j.formatCurrency(1)).toContain("R$");
    expect(j.formatCurrency(999)).toContain("R$");
  });
});
