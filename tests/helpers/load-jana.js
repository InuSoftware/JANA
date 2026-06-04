import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createNoopSupabaseMock } from "./supabase-mock.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appPath = path.join(root, "app.js");

let cachedExports = null;
let loaded = false;
let domPatched = false;

function createMockElement() {
  const el = document.createElement("div");
  el.querySelectorAll = () => [];
  return el;
}

function patchDomQueries() {
  if (domPatched) return;
  domPatched = true;

  const origQuerySelector = document.querySelector.bind(document);
  document.querySelector = (selector) => {
    if (typeof selector === "string" && selector.startsWith("#")) {
      const id = selector.slice(1);
      let node = document.getElementById(id);
      if (!node) {
        node = createMockElement();
        node.id = id;
        document.body.appendChild(node);
      }
      return node;
    }
    return origQuerySelector(selector) || createMockElement();
  };

  document.querySelectorAll = () => [];
}

function patchRefs(j) {
  for (const key of Object.keys(j.refs)) {
    const val = j.refs[key];
    if (val == null) {
      j.refs[key] = createMockElement();
    }
  }

  if (j.refs.loginScreen && !document.body.contains(j.refs.loginScreen)) {
    document.body.appendChild(j.refs.loginScreen);
  }
  if (j.refs.appScreen && !document.body.contains(j.refs.appScreen)) {
    document.body.appendChild(j.refs.appScreen);
  }

  let dashPanel = document.getElementById("dashboardTab");
  if (!dashPanel) {
    dashPanel = createMockElement();
    dashPanel.id = "dashboardTab";
    document.body.appendChild(dashPanel);
  }

  const bottomTab = createMockElement();
  bottomTab.dataset.tab = "dashboardTab";
  j.refs.bottomTabs = [bottomTab];
  j.refs.tabPanels = [dashPanel];

  const settingsTab = createMockElement();
  settingsTab.dataset.settingsTab = "products";
  j.refs.settingsTabButtons = [settingsTab];
}

function ensureAppLoaded() {
  if (loaded) return;
  loaded = true;

  patchDomQueries();

  globalThis.__SUPABASE_URL__ = globalThis.__SUPABASE_URL__ || "https://example.supabase.co";
  globalThis.__SUPABASE_ANON_KEY__ = globalThis.__SUPABASE_ANON_KEY__ || "anon-key-test";
  globalThis.__JANA_SKIP_INIT__ = true;

  let captured = null;
  globalThis.__JANA_REGISTER_TEST_EXPORTS__ = (payload) => {
    captured = payload;
  };

  const code = fs.readFileSync(appPath, "utf8");
  vm.runInThisContext(code, { filename: "app.js" });

  if (!captured) throw new Error("Falha ao carregar exports de app.js para testes.");
  cachedExports = captured;
  patchRefs(cachedExports);
}

export function loadJana() {
  ensureAppLoaded();
  resetJanaState(cachedExports);
  return cachedExports;
}

export function resetJanaState(j) {
  j.clearDataCache();
  j.state.user = null;
  j.state.selectedOrderId = null;
  j.state.pendingNewOrder = null;
  j.state.selectedFilter = "all";
  j.state.selectedTab = "dashboardTab";
  j.state.currentView = "main";
  j.state.config = j.loadConfig();
  j.state.cashCloseReferenceDateYmd = "";
  j.state.cashCloseReferenceShiftId = null;
  j.state.reopenShiftPendingConfirm = false;
  patchRefs(j);
  j.injectSupabaseClientForTests(createNoopSupabaseMock());
}

export function seedProducts(j, products) {
  j.state.cache.products = products.map((p) => ({ ...p }));
}

export function seedOrders(j, orders) {
  j.state.cache.commandas = orders.map((o) => JSON.parse(JSON.stringify(o)));
}

export function seedShifts(j, shifts) {
  j.state.cache.shifts = shifts.map((s) => ({ ...s }));
}

export function attachSupabaseMock(j, mockClient) {
  j.injectSupabaseClientForTests(mockClient);
  return mockClient;
}
