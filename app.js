/** Polyfill: crypto.randomUUID so existe em secure contexts (HTTPS/localhost). */
(function () {
  if (typeof globalThis.crypto !== "object") globalThis.crypto = {};
  if (typeof globalThis.crypto.randomUUID === "function") return;
  const getRandomValues =
    typeof globalThis.crypto.getRandomValues === "function"
      ? (arr) => globalThis.crypto.getRandomValues(arr)
      : (arr) => {
          for (let i = 0; i < arr.length; i++)
            arr[i] = (Math.random() * 256) & 0xff;
          return arr;
        };
  globalThis.crypto.randomUUID = function () {
    const b = getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((n) => n.toString(16).padStart(2, "0"));
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
  };
})();

/** Settings → API → Project URL (sem path). Remove /rest/v1 se vier da URL do Data API por engano. */
function normalizeSupabaseProjectUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) return u;
  while (u.endsWith("/")) u = u.slice(0, -1);
  if (/\/rest\/v1$/i.test(u)) u = u.replace(/\/rest\/v1$/i, "");
  while (u.endsWith("/")) u = u.slice(0, -1);
  return u;
}

function isSupabaseConfigured() {
  if (typeof window === "undefined") return false;
  const url = String(window.__SUPABASE_URL__ || "").trim();
  const key = String(window.__SUPABASE_ANON_KEY__ || "").trim();
  return url.length > 0 && key.length > 0;
}

let supabaseClient = null;

async function getSupabase() {
  if (!isSupabaseConfigured()) return null;
  if (supabaseClient) return supabaseClient;
  const { createClient } =
    await import("https://esm.sh/@supabase/supabase-js@2");
  const projectUrl = normalizeSupabaseProjectUrl(window.__SUPABASE_URL__);
  supabaseClient = createClient(projectUrl, window.__SUPABASE_ANON_KEY__, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
    },
  });
  return supabaseClient;
}

/** Apenas para testes de regressão (via __JANA_REGISTER_TEST_EXPORTS__). */
function injectSupabaseClientForTests(client) {
  supabaseClient = client;
}

function resetSupabaseClientForTests() {
  supabaseClient = null;
}

function isStockControlEnabled() {
  return state.config.useStock !== false;
}

function defaultConfigPayload() {
  return {
    id: 1,
    useTables: false,
    useServiceFee: true,
    useStock: true,
    activeTheme: "blue-service",
    categories: [
      "Bebidas",
      "Lanches",
      "Porcoes",
      "Pratos",
      "Sobremesas",
      "Outros",
    ],
    prepCategories: [],
    paymentMethods: [
      { id: "card", name: "Cartao", active: true },
      { id: "cash", name: "Dinheiro", active: true },
      { id: "pix", name: "PIX", active: true },
      { id: "voucher", name: "Vale Ref.", active: true },
    ],
  };
}

function normalizeStockComponentIds(productOrIds) {
  const raw =
    productOrIds == null
      ? []
      : Array.isArray(productOrIds)
        ? productOrIds
        : (productOrIds.stockComponentIds ??
          productOrIds.stock_component_ids ??
          []);
  const seen = new Set();
  const out = [];
  for (const id of raw) {
    const s = String(id || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function productRowToApp(row, stockQty) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: Number(row.price),
    requiresPrep: row.requires_prep === true,
    isSpecial: row.is_special === true,
    stockComponentIds: normalizeStockComponentIds(row.stock_component_ids),
    stockDisplayProductId: row.stock_display_product_id
      ? String(row.stock_display_product_id)
      : null,
    stock: stockQty != null ? Math.trunc(Number(stockQty) || 0) : 0,
  };
}

function productToRow(p) {
  const componentIds = normalizeStockComponentIds(p);
  let displayId = p.stockDisplayProductId
    ? String(p.stockDisplayProductId)
    : null;
  if (displayId && !componentIds.includes(displayId)) displayId = null;
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    price: p.price,
    requires_prep: p.requiresPrep === true,
    is_special: p.isSpecial === true,
    stock_component_ids: componentIds,
    stock_display_product_id: displayId,
  };
}

function findProductById(productId) {
  return loadProducts().find((entry) => String(entry.id) === String(productId));
}

/** Saldo mostrado no catalogo da comanda (item especial usa insumo principal ou minimo dos insumos). */
function getProductStockDisplayQuantity(product) {
  if (!product) return 0;
  if (!product.isSpecial) return getProductStock(product.id);
  const displayId = product.stockDisplayProductId;
  if (displayId) return getProductStock(displayId);
  const components = normalizeStockComponentIds(product);
  if (!components.length) return 0;
  return Math.min(...components.map((id) => getProductStock(id)));
}

function applyOrderLineStockDelta(product, delta) {
  if (!isStockControlEnabled() || !product || !delta) return;
  const d = Math.trunc(delta);
  if (!d) return;
  if (product.isSpecial) {
    for (const componentId of normalizeStockComponentIds(product)) {
      applyStockDeltaSilently(componentId, d);
    }
    return;
  }
  applyStockDeltaSilently(product.id, d);
}

function getProductStock(productId) {
  const product = loadProducts().find(
    (entry) => String(entry.id) === String(productId),
  );
  return product ? Math.trunc(Number(product.stock) || 0) : 0;
}

function setProductStockLocal(productId, quantity) {
  const product = loadProducts().find(
    (entry) => String(entry.id) === String(productId),
  );
  if (product) product.stock = Math.trunc(Number(quantity) || 0);
}

/** Debito/credito silencioso na venda ou cancelamento de item (nao bloqueia fluxo). */
function applyStockDeltaSilently(productId, delta) {
  if (!isStockControlEnabled() || !productId || !delta) return;
  const d = Math.trunc(delta);
  if (!d) return;
  setProductStockLocal(productId, getProductStock(productId) + d);
  void adjustProductStockRemote(productId, d).catch((e) =>
    console.error("[JANA] estoque", e),
  );
}

function restoreOrderItemsToStock(items) {
  for (const item of items || []) {
    const qty = Math.trunc(Number(item.qty) || 0);
    if (qty <= 0 || !item.productId) continue;
    const product = findProductById(item.productId);
    if (product) applyOrderLineStockDelta(product, qty);
    else applyStockDeltaSilently(item.productId, qty);
  }
}

function abandonPendingOrder() {
  if (state.pendingNewOrder?.items?.length) {
    restoreOrderItemsToStock(state.pendingNewOrder.items);
  }
  state.pendingNewOrder = null;
  if (state.selectedOrderId === PENDING_ORDER_ID) state.selectedOrderId = null;
}

function commandaToPayload(order) {
  return JSON.parse(JSON.stringify(order));
}

/** Documento JSON gravado em commandas.payload — sem `id` (PK só na coluna). */
function commandaPayloadDocument(order) {
  const doc = commandaToPayload(order);
  delete doc.id;
  return doc;
}

function toIsoTimestamptz(value) {
  if (value == null || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function todayLocalYmdFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localDateFromYmd(ymd) {
  const [y, m, day] = String(ymd || "")
    .slice(0, 10)
    .split("-")
    .map((n) => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, day || 1);
}

const WEEKDAY_FULL_PT = [
  "Domingo",
  "Segunda-feira",
  "Terca-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sabado",
];

function formatYmdWithWeekday(ymd) {
  if (!ymd) return "";
  const d = localDateFromYmd(ymd);
  const label = WEEKDAY_FULL_PT[d.getDay()] || "";
  const br = d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return `${label}, ${br}`;
}

function formatDateTimeShort(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Converte fechamento legado (daily_closes) para o mesmo formato de caixa fechado. */
function dailyCloseRowToShiftLike(row) {
  const dateYmd = row.dateYmd || "";
  const closedAt = row.closedAt || null;
  const sales = Array.isArray(row.sales) ? row.sales : [];
  let startedMs = null;
  for (const s of sales) {
    if (!s.closedAt) continue;
    const t = new Date(s.closedAt).getTime();
    if (!Number.isNaN(t) && (startedMs == null || t < startedMs)) startedMs = t;
  }
  let startedAt;
  if (startedMs != null) {
    startedAt = new Date(startedMs).toISOString();
  } else if (dateYmd) {
    const d = localDateFromYmd(dateYmd);
    d.setHours(0, 0, 0, 0);
    startedAt = d.toISOString();
  } else {
    startedAt = closedAt || new Date().toISOString();
  }
  const endedAt = closedAt || startedAt;
  const startD = new Date(startedAt);
  const endD = new Date(endedAt);
  const closeSnapshot = {
    dateYmd,
    closedAt: endedAt,
    activeOrdersCount: row.activeOrdersCount,
    totalBruto: row.totalBruto,
    finalizedOrdersCount: row.finalizedOrdersCount,
    sales,
  };
  return {
    id: `legacy-dc-${row.id}`,
    referenceDate: dateYmd,
    scheduledStart: localHmFromDate(startD).slice(0, 5),
    scheduledEnd: localHmFromDate(endD).slice(0, 5),
    windowStartAt: startedAt,
    windowEndAt: endedAt,
    startedAt,
    endedAt,
    status: "fechado",
    payload: { closeSnapshot, legacyDailyClose: true },
  };
}

function isDuplicateOfShift(dailyRow, shiftRow) {
  if (String(shiftRow.id) === String(dailyRow.id)) return true;
  const refA = shiftRow.referenceDate || "";
  const refB = dailyRow.dateYmd || "";
  if (refA !== refB) return false;
  const endA = new Date(shiftRow.endedAt || 0).getTime();
  const endB = new Date(dailyRow.closedAt || 0).getTime();
  if (Number.isNaN(endA) || Number.isNaN(endB)) return false;
  return Math.abs(endA - endB) < 120000;
}

/** Caixas fechados: tabela shifts + fechamentos antigos em daily_closes (sem duplicar). */
function loadAllClosedSessions() {
  const fromShifts = loadShifts().filter((s) => s.status === "fechado");
  const dailyRows = state.cache.dailyCloses || [];
  const legacy = dailyRows
    .map(dailyCloseRowToShiftLike)
    .filter(
      (leg) =>
        !fromShifts.some((sh) =>
          isDuplicateOfShift(
            {
              dateYmd: leg.referenceDate,
              closedAt: leg.endedAt,
              id: String(leg.id).replace(/^legacy-dc-/, ""),
            },
            sh,
          ),
        ),
    );
  return [...fromShifts, ...legacy].sort((a, b) => {
    const refCmp = (b.referenceDate || "").localeCompare(a.referenceDate || "");
    if (refCmp !== 0) return refCmp;
    return (
      new Date(b.endedAt || 0).getTime() - new Date(a.endedAt || 0).getTime()
    );
  });
}

function loadClosedShiftsFiltered(fromYmd, toYmd) {
  const from = fromYmd || "";
  const to = toYmd || "";
  return loadAllClosedSessions().filter((s) => {
    const ref = s.referenceDate || "";
    if (!from && !to) return true;
    if (from && ref < from) return false;
    if (to && ref > to) return false;
    return true;
  });
}

function shiftCloseReportSnapshot(shift) {
  const snap = shift.payload?.closeSnapshot;
  if (snap && typeof snap === "object" && snap.totalBruto != null) {
    return {
      totalBruto: Number(snap.totalBruto) || 0,
      finalizedOrdersCount: Number(snap.finalizedOrdersCount) || 0,
      activeOrdersCount: snap.activeOrdersCount,
      sales: Array.isArray(snap.sales) ? snap.sales : [],
    };
  }
  const orders = loadOrders();
  const slice = ordersFinalizedInShift(orders, shift);
  return {
    totalBruto: slice.reduce((s, o) => s + (o.totalPaid || 0), 0),
    finalizedOrdersCount: slice.length,
    activeOrdersCount: null,
    sales: slice.map((order) => ({
      orderId: order.id,
      customer: (order.customer || "").trim() || "Cliente sem nome",
      totalPaid: order.totalPaid || 0,
      paymentMethods: Array.isArray(order.paymentMethods)
        ? order.paymentMethods
        : [],
      itemsCount: (order.items || []).reduce(
        (sum, item) => sum + (item.qty || 0),
        0,
      ),
      closedAt: order.closedAt || order.createdAt || null,
    })),
  };
}

function renderShiftCloseReportCard(shift) {
  const snap = shiftCloseReportSnapshot(shift);
  const orders = loadOrders();
  const slice = ordersFinalizedInShift(orders, shift);
  const payShares = aggregatePaymentMethodShares(slice);
  const payRows = paymentSharesSorted(payShares);
  const sales = snap.sales || [];
  return `
    <li class="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-3 shadow-sm">
      <p class="text-sm font-extrabold text-primary">${formatYmdWithWeekday(shift.referenceDate)}${shift.payload?.legacyDailyClose ? ' <span class="text-[10px] font-normal text-on-surface-variant">(fechamento anterior)</span>' : ""}</p>
      <p class="mt-1 text-xs text-on-surface-variant">
        <span class="font-semibold text-on-surface">Abriu:</span> ${formatDateTimeShort(shift.startedAt)}
      </p>
      <p class="text-xs text-on-surface-variant">
        <span class="font-semibold text-on-surface">Fechou:</span> ${formatDateTimeShort(shift.endedAt)}
      </p>
      <div class="mt-2 grid grid-cols-2 gap-2">
        <div class="rounded-lg border border-outline-variant/60 bg-surface-container-low px-2 py-1.5">
          <p class="text-[10px] font-semibold uppercase text-on-surface-variant">Bruto</p>
          <p class="text-lg font-extrabold text-secondary">${formatCurrency(snap.totalBruto)}</p>
        </div>
        <div class="rounded-lg border border-outline-variant/60 bg-surface-container-low px-2 py-1.5">
          <p class="text-[10px] font-semibold uppercase text-on-surface-variant">Comandas</p>
          <p class="text-lg font-extrabold text-primary">${snap.finalizedOrdersCount}</p>
        </div>
      </div>
      ${
        snap.activeOrdersCount != null
          ? `<p class="mt-1 text-[10px] text-on-surface-variant">Em aberto no fechamento: ${snap.activeOrdersCount}</p>`
          : ""
      }
      ${
        payRows.length
          ? `<p class="mt-2 text-[10px] font-semibold uppercase text-on-surface-variant">Pagamentos</p>
             <ul class="mt-1 space-y-1">
               ${payRows
                 .map(
                   (row) => `
                 <li class="flex justify-between text-xs">
                   <span>${row.name}</span>
                   <span class="font-bold text-primary">${formatCurrency(row.value)}</span>
                 </li>`,
                 )
                 .join("")}
             </ul>`
          : ""
      }
      ${
        sales.length
          ? `<p class="mt-2 text-[10px] font-semibold uppercase text-on-surface-variant">Vendas do caixa</p>
             <ul class="mt-1 max-h-40 space-y-1 overflow-y-auto">
               ${sales
                 .map(
                   (sale) => `
                 <li class="rounded border border-outline-variant/50 px-2 py-1 text-[11px]">
                   <span class="font-semibold text-on-surface">${sale.customer || "Cliente"}</span>
                   · ${formatCurrency(sale.totalPaid || 0)}
                   <span class="text-on-surface-variant"> · ${sale.itemsCount ?? 0} it.</span>
                 </li>`,
                 )
                 .join("")}
             </ul>`
          : ""
      }
    </li>`;
}

function localHmFromDate(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:00`;
}

function shiftRowToApp(row) {
  const ref =
    row.reference_date != null
      ? typeof row.reference_date === "string"
        ? row.reference_date.slice(0, 10)
        : String(row.reference_date).slice(0, 10)
      : "";
  const schedStart =
    row.scheduled_start != null ? String(row.scheduled_start).slice(0, 5) : "";
  const schedEnd =
    row.scheduled_end != null ? String(row.scheduled_end).slice(0, 5) : "";
  return {
    id: row.id,
    referenceDate: ref,
    scheduledStart: schedStart,
    scheduledEnd: schedEnd,
    windowStartAt: row.window_start_at,
    windowEndAt: row.window_end_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status === "fechado" ? "fechado" : "aberto",
    payload: row.payload && typeof row.payload === "object" ? row.payload : {},
  };
}

function loadShifts() {
  return state.cache.shifts || [];
}

function getOpenShift() {
  return loadShifts().find((s) => s.status === "aberto") || null;
}

/** Turno criado pela versao antiga (18h–02h automatico), sem vendas nem comandas abertas depois. */
function isLegacyAutoOpenShift(shift) {
  if (!shift || shift.status !== "aberto") return false;
  if (shift.scheduledStart !== "18:00" || shift.scheduledEnd !== "02:00")
    return false;
  const payload = shift.payload || {};
  return !payload.closeSnapshot && !payload.inferredFromOpenOrders;
}

function shiftHasRegisterActivity(shift, orders) {
  if (!shift) return false;
  if (ordersFinalizedInShift(orders, shift).length > 0) return true;
  const startMs = new Date(shift.startedAt).getTime();
  if (Number.isNaN(startMs)) return false;
  return orders.some((o) => {
    if (normalizeOrderStatus(o.status) !== "Aberta") return false;
    const created = o.createdAt ? new Date(o.createdAt).getTime() : NaN;
    return !Number.isNaN(created) && created >= startMs;
  });
}

function shouldInferOpenShiftFromOpenOrders(orders) {
  if (getOpenShift()) return false;
  const openOrders = orders.filter(
    (o) => normalizeOrderStatus(o.status) === "Aberta",
  );
  if (!openOrders.length) return false;
  let earliestMs = Infinity;
  for (const o of openOrders) {
    const t = o.createdAt ? new Date(o.createdAt).getTime() : NaN;
    if (!Number.isNaN(t) && t < earliestMs) earliestMs = t;
  }
  if (!Number.isFinite(earliestMs)) return false;
  const hasCloseAfter = loadShifts()
    .filter((s) => s.status === "fechado" && s.endedAt)
    .some((s) => new Date(s.endedAt).getTime() >= earliestMs);
  return !hasCloseAfter;
}

async function reconcileShiftsAfterBootstrap() {
  const orders = loadOrders();
  const open = getOpenShift();
  if (
    open &&
    isLegacyAutoOpenShift(open) &&
    !shiftHasRegisterActivity(open, orders)
  ) {
    const closed = await closeShiftRemote(open, {
      totalBruto: 0,
      finalizedOrdersCount: 0,
      sales: [],
      legacyAutoClosed: true,
    });
    state.cache.shifts = loadShifts().map((s) =>
      String(s.id) === String(closed.id) ? closed : s,
    );
  }
  if (!shouldInferOpenShiftFromOpenOrders(orders)) return;
  const openOrders = orders.filter(
    (o) => normalizeOrderStatus(o.status) === "Aberta",
  );
  let earliestMs = Infinity;
  let startedAt = openOrders[0]?.createdAt || new Date().toISOString();
  for (const o of openOrders) {
    const t = o.createdAt ? new Date(o.createdAt).getTime() : NaN;
    if (!Number.isNaN(t) && t < earliestMs) {
      earliestMs = t;
      startedAt = o.createdAt;
    }
  }
  for (const o of orders) {
    if (normalizeOrderStatus(o.status) !== "Finalizado" || o.shiftId) continue;
    const t = new Date(o.closedAt || o.createdAt).getTime();
    if (!Number.isNaN(t) && t < earliestMs) {
      earliestMs = t;
      startedAt = o.closedAt || o.createdAt;
    }
  }
  const startedDate = new Date(startedAt);
  const created = await insertShiftRemote({
    referenceDate: todayLocalYmdFromDate(startedDate),
    startedAt,
  });
  const withMeta = { ...created, payload: { inferredFromOpenOrders: true } };
  const sb = await getSupabase();
  if (sb) {
    await sb
      .from("shifts")
      .update({ payload: { inferredFromOpenOrders: true } })
      .eq("id", String(created.id));
  }
  state.cache.shifts = [
    withMeta,
    ...loadShifts().filter((s) => String(s.id) !== String(created.id)),
  ];
}

function formatShiftLabel(shift) {
  if (!shift) return "";
  const opened = shift.startedAt
    ? new Date(shift.startedAt).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  return shift.status === "fechado"
    ? `Caixa (fechado ${opened})`
    : `Caixa aberto desde ${opened}`;
}

function orderBelongsToShift(order, shift) {
  if (!shift || normalizeOrderStatus(order.status) !== "Finalizado")
    return false;
  if (order.shiftId && String(order.shiftId) === String(shift.id)) return true;
  const closedIso = order.closedAt || order.createdAt;
  if (!closedIso) return false;
  const t = new Date(closedIso).getTime();
  const start = new Date(shift.startedAt).getTime();
  const end =
    shift.status === "fechado" && shift.endedAt
      ? new Date(shift.endedAt).getTime()
      : Date.now();
  if (t >= start && t <= end) return true;
  if (shift.payload?.inferredFromOpenOrders && !order.shiftId && t <= end)
    return true;
  return false;
}

function ordersFinalizedInShift(orders, shift) {
  if (!shift) return [];
  return orders.filter((o) => orderBelongsToShift(o, shift));
}

function ordersForDashboard(orders, shift) {
  const open = orders.filter(
    (o) => normalizeOrderStatus(o.status) === "Aberta",
  );
  if (!shift) return open;
  const finalized = ordersFinalizedInShift(orders, shift);
  const seen = new Set();
  return [...open, ...finalized].filter((o) => {
    const k = String(o.id);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function computeCashCloseDraft(shift) {
  if (!shift) {
    return {
      shiftId: null,
      referenceDate: "",
      activeOrdersCount: 0,
      totalBruto: 0,
      finalizedOrdersCount: 0,
      sales: [],
    };
  }
  const orders = loadOrders();
  const slice = ordersFinalizedInShift(orders, shift);
  const activeOrdersCount = getOpenOrders().length;
  return {
    shiftId: shift.id,
    referenceDate: shift.referenceDate || "",
    activeOrdersCount,
    totalBruto: slice.reduce((s, o) => s + (o.totalPaid || 0), 0),
    finalizedOrdersCount: slice.length,
    sales: slice.map((order) => ({
      orderId: order.id,
      customer: (order.customer || "").trim() || "Cliente sem nome",
      totalPaid: order.totalPaid || 0,
      paymentMethods: Array.isArray(order.paymentMethods)
        ? order.paymentMethods
        : [],
      itemsCount: (order.items || []).reduce(
        (sum, item) => sum + (item.qty || 0),
        0,
      ),
      closedAt: order.closedAt || order.createdAt || null,
    })),
  };
}

function isValidYmd(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) return false;
  const d = localDateFromYmd(ymd);
  const [y, m, day] = String(ymd)
    .slice(0, 10)
    .split("-")
    .map((n) => parseInt(n, 10));
  return d.getFullYear() === y && d.getMonth() === m - 1 && d.getDate() === day;
}

/** Sugere o dia de referencia a partir das vendas do caixa ou da data ja definida no turno. */
function suggestReferenceDateForShift(shift) {
  if (!shift) return todayLocalYmd();
  const orders = loadOrders();
  const slice = ordersFinalizedInShift(orders, shift);
  let minYmd = "";
  for (const o of slice) {
    const ymd = localYmdFromIso(o.closedAt || o.createdAt);
    if (!ymd) continue;
    if (!minYmd || ymd < minYmd) minYmd = ymd;
  }
  if (minYmd) return minYmd;
  if (shift.referenceDate && isValidYmd(shift.referenceDate))
    return shift.referenceDate;
  return todayLocalYmdFromDate(new Date(shift.startedAt || Date.now()));
}

function getCashCloseReferenceDateForUi(shift) {
  if (!shift) return todayLocalYmd();
  if (state.cashCloseReferenceShiftId !== String(shift.id)) {
    state.cashCloseReferenceShiftId = String(shift.id);
    state.cashCloseReferenceDateYmd = suggestReferenceDateForShift(shift);
  } else if (!state.cashCloseReferenceDateYmd) {
    state.cashCloseReferenceDateYmd = suggestReferenceDateForShift(shift);
  }
  return state.cashCloseReferenceDateYmd;
}

async function ensureProfile(session, supabase) {
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", session.user.id)
    .maybeSingle();
  if (data) return;
  const { error } = await supabase.from("profiles").insert({
    id: session.user.id,
    display_name: session.user.email?.split("@")[0] || "Usuario",
    role: "Gerente",
  });
  if (error && error.code !== "23505") {
    console.warn("[JANA] ensureProfile:", error.message);
  }
}

async function bootstrapFromSupabase(session) {
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Supabase indisponivel");
  const { error: sessionErr } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (sessionErr) {
    console.warn("[JANA] setSession:", sessionErr.message);
  }
  await ensureProfile(session, supabase);

  const [pRes, stockRes, cRes, sRes, dRes, cfgRes, profRes] = await Promise.all(
    [
      supabase.from("products").select("*"),
      supabase.from("product_stock").select("product_id, quantity"),
      supabase
        .from("commandas")
        .select(
          "id, payload, status, created_at, updated_at, closed_at, shift_id",
        ),
      supabase
        .from("shifts")
        .select("*")
        .order("started_at", { ascending: false }),
      supabase.from("daily_closes").select("id, payload, closed_at, date_ymd"),
      supabase.from("app_config").select("payload").maybeSingle(),
      supabase
        .from("profiles")
        .select("display_name, role")
        .eq("id", session.user.id)
        .maybeSingle(),
    ],
  );

  if (pRes.error) throw pRes.error;
  if (stockRes.error) {
    console.warn(
      "[JANA] product_stock indisponivel (rode 010_product_stock.sql):",
      stockRes.error.message,
    );
  }
  if (cRes.error) throw cRes.error;
  if (sRes.error) {
    console.warn(
      "[JANA] shifts indisponivel (rode 003_shifts.sql):",
      sRes.error.message,
    );
  }
  if (dRes.error) throw dRes.error;
  if (cfgRes.error) throw cfgRes.error;
  if (profRes.error) throw profRes.error;

  const stockByProduct = {};
  for (const row of stockRes.error ? [] : stockRes.data || []) {
    stockByProduct[row.product_id] = Math.trunc(Number(row.quantity) || 0);
  }
  state.cache.products = (pRes.data || []).map((row) =>
    productRowToApp(row, stockByProduct[row.id] ?? 0),
  );
  state.cache.commandas = (cRes.data || []).map((r) => {
    const base = { ...(r.payload || {}), id: r.id };
    if (r.status != null && r.status !== "") base.status = r.status;
    if (r.closed_at != null) base.closedAt = r.closed_at;
    if (r.created_at != null) base.createdAt = r.created_at;
    if (r.shift_id != null) base.shiftId = r.shift_id;
    return base;
  });
  state.cache.shifts = sRes.error ? [] : (sRes.data || []).map(shiftRowToApp);
  state.cache.dailyCloses = (dRes.data || []).map((r) => {
    const p = r.payload || {};
    let dateYmd = p.dateYmd;
    if (r.date_ymd != null) {
      dateYmd =
        typeof r.date_ymd === "string"
          ? r.date_ymd.slice(0, 10)
          : String(r.date_ymd).slice(0, 10);
    }
    return {
      ...p,
      id: r.id,
      closedAt: r.closed_at ?? p.closedAt,
      dateYmd: dateYmd ?? p.dateYmd,
    };
  });

  if (cfgRes.data?.payload && typeof cfgRes.data.payload === "object") {
    state.cache.config = { ...cfgRes.data.payload };
  } else {
    const def = defaultConfigPayload();
    const up = await supabase
      .from("app_config")
      .upsert(
        { user_id: session.user.id, payload: def },
        { onConflict: "user_id" },
      );
    if (up.error) throw up.error;
    state.cache.config = def;
  }

  const pr = profRes.data;
  setLoggedUser({
    id: session.user.id,
    email: session.user.email,
    username:
      pr?.display_name || session.user.email?.split("@")[0] || "Usuario",
    role: pr?.role || "Atendente",
  });

  state.config = loadConfig();
}

/** Carrega dados e UI após sessão válida (reload com sessão ou login explícito). */
async function applySupabaseSession(session) {
  if (!session?.user) {
    renderAuth();
    return;
  }
  if (state.user && state.user.id === session.user.id) {
    return;
  }
  try {
    await bootstrapFromSupabase(session);
    await reconcileShiftsAfterBootstrap();
    state.config = loadConfig();
    applyTheme();
    renderAuth();
  } catch (e) {
    console.error("[JANA] applySupabaseSession", e);
    const detail =
      (e && typeof e === "object" && e.message) ||
      (e && typeof e === "object" && e.details) ||
      String(e || "");
    refs.loginFeedback.textContent =
      detail && detail.length < 280
        ? `Erro ao carregar dados: ${detail}`
        : "Erro ao carregar dados. Abra o console (F12). Se aparecer permission denied (403), rode supabase/migrations/002_api_grants.sql no SQL Editor.";
    renderAuth();
  }
}

async function upsertProductRemote(product) {
  const sb = await getSupabase();
  if (!sb) return;
  const { error } = await sb.from("products").upsert(productToRow(product));
  if (error) throw error;
}

async function deleteProductRemote(productId) {
  const sb = await getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from("products")
    .delete()
    .eq("id", String(productId));
  if (error) throw error;
}

async function adjustProductStockRemote(productId, delta) {
  const sb = await getSupabase();
  if (!sb) return;
  const { error } = await sb.rpc("adjust_product_stock", {
    p_product_id: String(productId),
    p_delta: Math.trunc(delta),
  });
  if (error) throw error;
}

async function setProductStockRemote(productId, quantity) {
  const sb = await getSupabase();
  if (!sb) return;
  const { error } = await sb.rpc("set_product_stock", {
    p_product_id: String(productId),
    p_quantity: Math.trunc(quantity),
  });
  if (error) throw error;
}

async function ensureProductStockRowRemote(productId) {
  if (!isStockControlEnabled()) return;
  try {
    await setProductStockRemote(productId, getProductStock(productId));
  } catch (e) {
    console.error("[JANA] ensureProductStockRow", e);
  }
}

async function upsertCommandaRemote(order) {
  const sb = await getSupabase();
  if (!sb) return;
  const createdRaw =
    toIsoTimestamptz(order.createdAt) || new Date().toISOString();
  const row = {
    id: order.id,
    payload: commandaPayloadDocument(order),
    status: order.status || "Aberta",
    closed_at: toIsoTimestamptz(order.closedAt),
    created_at: createdRaw,
    shift_id: order.shiftId || null,
  };
  const { error } = await sb.from("commandas").upsert(row);
  if (error) throw error;
}

async function deleteCommandaRemote(orderId) {
  const sb = await getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from("commandas")
    .delete()
    .eq("id", String(orderId));
  if (error) throw error;
}

async function upsertAppConfigRemote(config) {
  const sb = await getSupabase();
  if (!sb) return;
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return;
  const { error } = await sb
    .from("app_config")
    .upsert(
      { user_id: uid, payload: { ...config } },
      { onConflict: "user_id" },
    );
  if (error) throw error;
}

async function insertDailyCloseRemote(id, payloadDoc) {
  const sb = await getSupabase();
  if (!sb) return;
  const closed_at = toIsoTimestamptz(payloadDoc.closedAt);
  const dateYmd = payloadDoc.dateYmd;
  if (!dateYmd || String(dateYmd).trim() === "") {
    throw new Error("daily_close sem dateYmd");
  }
  const date_ymd = String(dateYmd).slice(0, 10);
  const { error } = await sb.from("daily_closes").insert({
    id,
    payload: payloadDoc,
    closed_at: closed_at || new Date().toISOString(),
    date_ymd,
  });
  if (error) throw error;
}

async function deleteDailyCloseRemote(closeId) {
  const sb = await getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from("daily_closes")
    .delete()
    .eq("id", String(closeId));
  if (error) throw error;
}

async function insertShiftRemote(shift) {
  const sb = await getSupabase();
  if (!sb) throw new Error("Supabase indisponivel");
  const startedAt = shift.startedAt || new Date().toISOString();
  const startedDate = new Date(startedAt);
  const referenceDate =
    shift.referenceDate || todayLocalYmdFromDate(startedDate);
  const hm = localHmFromDate(startedDate);
  const { data, error } = await sb
    .from("shifts")
    .insert({
      reference_date: referenceDate,
      scheduled_start: hm,
      scheduled_end: hm,
      window_start_at: startedAt,
      window_end_at: startedAt,
      started_at: startedAt,
      status: "aberto",
      payload: {},
    })
    .select("*")
    .single();
  if (error) throw error;
  return shiftRowToApp(data);
}

async function closeShiftRemote(shift, closePayload, referenceDateYmd) {
  const sb = await getSupabase();
  if (!sb) throw new Error("Supabase indisponivel");
  const endedAt = new Date().toISOString();
  const endedDate = new Date(endedAt);
  const referenceDate =
    referenceDateYmd && isValidYmd(referenceDateYmd)
      ? referenceDateYmd
      : shift.referenceDate || todayLocalYmdFromDate(endedDate);
  const snapshot = { ...closePayload, referenceDate };
  const { data, error } = await sb
    .from("shifts")
    .update({
      reference_date: referenceDate,
      status: "fechado",
      ended_at: endedAt,
      window_end_at: endedAt,
      scheduled_end: localHmFromDate(endedDate),
      payload: { closeSnapshot: snapshot, closedAt: endedAt, referenceDate },
    })
    .eq("id", String(shift.id))
    .select("*")
    .single();
  if (error) throw error;
  return shiftRowToApp(data);
}

async function reopenShiftRemote(shiftId) {
  const sb = await getSupabase();
  if (!sb) throw new Error("Supabase indisponivel");
  const { data, error } = await sb
    .from("shifts")
    .update({ status: "aberto", ended_at: null, payload: {} })
    .eq("id", String(shiftId))
    .select("*")
    .single();
  if (error) throw error;
  return shiftRowToApp(data);
}

async function openShiftManual() {
  if (getOpenShift())
    throw new Error("Ja existe um caixa aberto. Feche-o antes de abrir outro.");
  const now = new Date();
  const created = await insertShiftRemote({
    referenceDate: todayLocalYmdFromDate(now),
    startedAt: now.toISOString(),
  });
  state.cache.shifts = [
    created,
    ...loadShifts().filter((s) => String(s.id) !== String(created.id)),
  ];
  state.cashCloseReferenceDateYmd = "";
  state.cashCloseReferenceShiftId = null;
  return created;
}

/** Abre o caixa se estiver fechado (ex.: primeira comanda do dia). */
async function ensureOpenShiftAuto() {
  if (getOpenShift()) return true;
  try {
    await openShiftManual();
    return true;
  } catch (e) {
    console.error("[JANA] ensureOpenShiftAuto", e);
    alert(
      (e && e.message) || "Nao foi possivel abrir o caixa automaticamente.",
    );
    return false;
  }
}

async function persistShiftClose(shift, referenceDateYmd) {
  const ref =
    referenceDateYmd && isValidYmd(referenceDateYmd)
      ? referenceDateYmd
      : suggestReferenceDateForShift(shift);
  const draft = computeCashCloseDraft(shift);
  draft.referenceDate = ref;
  const closed = await closeShiftRemote(shift, draft, ref);
  const list = loadShifts().map((s) =>
    String(s.id) === String(closed.id) ? closed : s,
  );
  state.cache.shifts = list;
  state.cashCloseReferenceDateYmd = "";
  state.cashCloseReferenceShiftId = null;
  return closed;
}

function getLastClosedShift() {
  const closed = loadShifts()
    .filter((s) => s.status === "fechado" && s.endedAt)
    .sort(
      (a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime(),
    );
  return closed[0] || null;
}

function canUndoLastShiftClose() {
  if (getOpenShift()) return false;
  return Boolean(getLastClosedShift());
}

function undoLastShiftCloseHint() {
  if (getOpenShift()) {
    return "Feche o caixa aberto antes. Desfazer reabre o ultimo fechado (o mesmo turno), nao um caixa antigo qualquer.";
  }
  const last = getLastClosedShift();
  if (!last) return "Nao ha caixa fechado para desfazer.";
  const ref = last.referenceDate
    ? last.referenceDate.split("-").reverse().join("/")
    : "";
  return `Reabre o ultimo caixa fechado (ref. ${ref || "—"}). E sempre o mesmo registro — nao escolhe dia no historico.`;
}

async function rollbackLastClosedShift() {
  const target = getLastClosedShift();
  if (!target) return false;
  if (getOpenShift()) {
    throw new Error(
      "Feche o caixa aberto antes de desfazer o ultimo fechamento.",
    );
  }
  const reopened = await reopenShiftRemote(target.id);
  state.cache.shifts = loadShifts().map((s) =>
    String(s.id) === String(reopened.id) ? reopened : s,
  );
  return true;
}

const PENDING_ORDER_ID = "__pending__";
let _pendingOrderPostChain = Promise.resolve();
/** Botao Adicionar item: estado de pressao para feedback visual. */
let globalButtonPressTarget = null;
/** Atualiza cronometros na lista da comanda (1s) */
let orderItemsTimerInterval = null;
const THEME_PRESETS = {
  "dark-pro": { label: "Dark Pro", description: "Escuro confortavel" },
  apple: { label: "Apple", description: "Limpo e sofisticado" },
  "blue-service": { label: "Blue Service", description: "Azul institucional" },
};

const state = {
  user: null,
  selectedFilter: "all",
  selectedOrderId: null,
  selectedTab: "dashboardTab",
  selectedSettingsTab: "products",
  selectedCategory: "Todas",
  productAdminCategoryFilter: "Todas",
  stockAdminCategoryFilter: "Todas",
  productSearch: "",
  detailAction: null,
  cancelConfirmOpen: false,
  currentView: "main",
  pendingNewOrder: null,
  selectedReport: null,
  reportDateFrom: "",
  reportDateTo: "",
  cashCloseUiMessage: null,
  cashClosePendingClose: false,
  reopenShiftPendingConfirm: false,
  cashCloseReferenceDateYmd: "",
  cashCloseReferenceShiftId: null,
  cashCloseHistoryExpandedId: null,
  config: {
    id: 1,
    useTables: false,
    useServiceFee: true,
    useStock: true,
    activeTheme: "blue-service",
    categories: [
      "Bebidas",
      "Lanches",
      "Porcoes",
      "Pratos",
      "Sobremesas",
      "Outros",
    ],
    prepCategories: [],
    paymentMethods: [
      { id: "card", name: "Cartao", active: true },
      { id: "cash", name: "Dinheiro", active: true },
      { id: "pix", name: "PIX", active: true },
      { id: "voucher", name: "Vale Ref.", active: true },
    ],
  },
  cache: {
    commandas: [],
    products: [],
    config: {
      id: 1,
      useTables: false,
      useServiceFee: true,
      useStock: true,
      activeTheme: "blue-service",
      categories: [
        "Bebidas",
        "Lanches",
        "Porcoes",
        "Pratos",
        "Sobremesas",
        "Outros",
      ],
      prepCategories: [],
      paymentMethods: [
        { id: "card", name: "Cartao", active: true },
        { id: "cash", name: "Dinheiro", active: true },
        { id: "pix", name: "PIX", active: true },
        { id: "voucher", name: "Vale Ref.", active: true },
      ],
    },
    dailyCloses: [],
    shifts: [],
  },
};

function clearDataCache() {
  state.cache.products = [];
  state.cache.commandas = [];
  state.cache.dailyCloses = [];
  state.cache.shifts = [];
  state.cache.config = defaultConfigPayload();
}

const refs = {
  loginScreen: document.querySelector("#loginScreen"),
  appScreen: document.querySelector("#appScreen"),
  appHeader: document.querySelector("#appHeader"),
  appBottomNav: document.querySelector("#appBottomNav"),
  mainContent: document.querySelector("#mainContent"),
  loginForm: document.querySelector("#loginForm"),
  usernameInput: document.querySelector("#usernameInput"),
  passwordInput: document.querySelector("#passwordInput"),
  biometricButton: document.querySelector("#biometricButton"),
  loginFeedback: document.querySelector("#loginFeedback"),
  currentUserLabel: document.querySelector("#currentUserLabel"),
  openSettingsButton: document.querySelector("#openSettingsButton"),
  logoutButton: document.querySelector("#logoutButton"),
  shiftBar: document.querySelector("#shiftBar"),
  openShiftButton: document.querySelector("#openShiftButton"),
  dailySalesCount: document.querySelector("#dailySalesCount"),
  activeOrdersCount: document.querySelector("#activeOrdersCount"),
  dailyRevenueValue: document.querySelector("#dailyRevenueValue"),
  ordersList: document.querySelector("#ordersList"),
  statusFilters: [...document.querySelectorAll(".status-filter")],
  newOrderButton: document.querySelector("#newOrderButton"),
  homeButton: document.querySelector("#homeButton"),
  bottomTabs: [...document.querySelectorAll(".bottom-tab")],
  tabPanels: [...document.querySelectorAll(".tab-panel")],
  orderDialog: document.querySelector("#orderDialog"),
  closeOrderDialogButton: document.querySelector("#closeOrderDialogButton"),
  orderForm: document.querySelector("#orderForm"),
  orderTableInput: document.querySelector("#orderTableInput"),
  detailDialog: document.querySelector("#detailDialog"),
  confirmDetailButton: document.querySelector("#confirmDetailButton"),
  closeDetailDialogButton: document.querySelector("#closeDetailDialogButton"),
  detailTitle: document.querySelector("#detailTitle"),
  detailStatus: document.querySelector("#detailStatus"),
  detailCustomerInput: document.querySelector("#detailCustomerInput"),
  detailCustomerFeedback: document.querySelector("#detailCustomerFeedback"),
  detailCustomerHint: document.querySelector("#detailCustomerHint"),
  detailCustomerSlotTop: document.querySelector("#detailCustomerSlotTop"),
  detailCustomerSlotBottom: document.querySelector("#detailCustomerSlotBottom"),
  detailCustomerSection: document.querySelector("#detailCustomerSection"),
  saveCustomerButton: document.querySelector("#saveCustomerButton"),
  addFlowContent: document.querySelector("#addFlowContent"),
  openCancelFlowButton: document.querySelector("#openCancelFlowButton"),
  cancelConfirmBox: document.querySelector("#cancelConfirmBox"),
  confirmCancelOrderButton: document.querySelector("#confirmCancelOrderButton"),
  dismissCancelOrderButton: document.querySelector("#dismissCancelOrderButton"),
  productSearchInput: document.querySelector("#productSearchInput"),
  categoryTabsScroll: document.querySelector("#categoryTabsScroll"),
  categoryTabsLeftHint: document.querySelector("#categoryTabsLeftHint"),
  categoryTabsRightHint: document.querySelector("#categoryTabsRightHint"),
  categoryButtons: document.querySelector("#categoryButtons"),
  availableProductsList: document.querySelector("#availableProductsList"),
  orderItemsList: document.querySelector("#orderItemsList"),
  orderSubtotalLabel: document.querySelector("#orderSubtotalLabel"),
  checkoutButton: document.querySelector("#checkoutButton"),
  checkoutDialog: document.querySelector("#checkoutDialog"),
  closeCheckoutDialogButton: document.querySelector(
    "#closeCheckoutDialogButton",
  ),
  checkoutSummary: document.querySelector("#checkoutSummary"),
  checkoutPaymentMethodsList: document.querySelector(
    "#checkoutPaymentMethodsList",
  ),
  serviceFeeField: document.querySelector("#serviceFeeField"),
  serviceFeeInput: document.querySelector("#serviceFeeInput"),
  confirmCheckoutButton: document.querySelector("#confirmCheckoutButton"),
  checkoutFeedback: document.querySelector("#checkoutFeedback"),
  cashCloseHistoryDialog: document.querySelector("#cashCloseHistoryDialog"),
  closeCashCloseHistoryButton: document.querySelector(
    "#closeCashCloseHistoryButton",
  ),
  cashCloseHistoryBody: document.querySelector("#cashCloseHistoryBody"),
  productForm: document.querySelector("#productForm"),
  productIdInput: document.querySelector("#productIdInput"),
  productSubmitButton: document.querySelector("#productSubmitButton"),
  productNameInput: document.querySelector("#productNameInput"),
  productCategoryInput: document.querySelector("#productCategoryInput"),
  productPriceInput: document.querySelector("#productPriceInput"),
  productRequiresPrepInput: document.querySelector("#productRequiresPrepInput"),
  productSpecialInput: document.querySelector("#productSpecialInput"),
  productSpecialPanel: document.querySelector("#productSpecialPanel"),
  productStockComponentsList: document.querySelector(
    "#productStockComponentsList",
  ),
  productStockDisplaySelect: document.querySelector(
    "#productStockDisplaySelect",
  ),
  clearProductFormButton: document.querySelector("#clearProductFormButton"),
  productsList: document.querySelector("#productsList"),
  stockProductsList: document.querySelector("#stockProductsList"),
  stockSaveAllButton: document.querySelector("#stockSaveAllButton"),
  stockAdminFeedback: document.querySelector("#stockAdminFeedback"),
  stockAdminCategoryButtons: document.querySelector(
    "#stockAdminCategoryButtons",
  ),
  stockAdminCategoryTabsLeftHint: document.querySelector(
    "#stockAdminCategoryTabsLeftHint",
  ),
  stockAdminCategoryTabsRightHint: document.querySelector(
    "#stockAdminCategoryTabsRightHint",
  ),
  productAdminCategoryButtons: document.querySelector(
    "#productAdminCategoryButtons",
  ),
  productAdminCategoryTabsLeftHint: document.querySelector(
    "#productAdminCategoryTabsLeftHint",
  ),
  productAdminCategoryTabsRightHint: document.querySelector(
    "#productAdminCategoryTabsRightHint",
  ),
  tableModeToggle: document.querySelector("#tableModeToggle"),
  serviceFeeToggle: document.querySelector("#serviceFeeToggle"),
  stockModeToggle: document.querySelector("#stockModeToggle"),
  productStockFeaturesWrap: document.querySelector("#productStockFeaturesWrap"),
  settingsTabInventoryButton: document.querySelector(
    '[data-settings-tab="inventory"]',
  ),
  orderTableGroup: document.querySelector("#orderTableGroup"),
  categoryForm: document.querySelector("#categoryForm"),
  categoryNameInput: document.querySelector("#categoryNameInput"),
  categoryFeedback: document.querySelector("#categoryFeedback"),
  categoriesList: document.querySelector("#categoriesList"),
  settingsTabButtons: [...document.querySelectorAll(".settings-tab-button")],
  settingsPanels: [...document.querySelectorAll(".settings-panel")],
  settingsTabsScroll: document.querySelector("#settingsTabsScroll"),
  settingsTabsLeftHint: document.querySelector("#settingsTabsLeftHint"),
  settingsTabsRightHint: document.querySelector("#settingsTabsRightHint"),
  paymentMethodForm: document.querySelector("#paymentMethodForm"),
  paymentMethodNameInput: document.querySelector("#paymentMethodNameInput"),
  paymentMethodFeedback: document.querySelector("#paymentMethodFeedback"),
  paymentMethodsSettingsList: document.querySelector(
    "#paymentMethodsSettingsList",
  ),
  activeThemeLabel: document.querySelector("#activeThemeLabel"),
  themePresetList: document.querySelector("#themePresetList"),
  confirmSettingsButton: document.querySelector("#confirmSettingsButton"),
  reopenFilterDateInput: document.querySelector("#reopenFilterDateInput"),
  reopenSearchButton: document.querySelector("#reopenSearchButton"),
  reopenOrdersList: document.querySelector("#reopenOrdersList"),
  reopenPanelFeedback: document.querySelector("#reopenPanelFeedback"),
  reopenConfirmDialog: document.querySelector("#reopenConfirmDialog"),
  reopenConfirmAcceptButton: document.querySelector(
    "#reopenConfirmAcceptButton",
  ),
  reopenConfirmDismissButton: document.querySelector(
    "#reopenConfirmDismissButton",
  ),
  reopenShiftSummary: document.querySelector("#reopenShiftSummary"),
  reopenShiftUndoButton: document.querySelector("#reopenShiftUndoButton"),
  reopenShiftFeedback: document.querySelector("#reopenShiftFeedback"),
  reportsDateFromInput: document.querySelector("#reportsDateFromInput"),
  reportsDateToInput: document.querySelector("#reportsDateToInput"),
  reportsPicker: document.querySelector("#reportsPicker"),
  reportsDetail: document.querySelector("#reportsDetail"),
  reportsDetailBody: document.querySelector("#reportsDetailBody"),
  reportsBackButton: document.querySelector("#reportsBackButton"),
};

/** Evita flash da tela de login ao recarregar com sessão Supabase salva no navegador. */
function hideAuthBootScreen() {
  const el = document.getElementById("__authBoot");
  if (el) el.remove();
}

function showAuthBootScreen() {
  if (!isSupabaseConfigured()) return;
  if (document.getElementById("__authBoot")) return;
  if (refs.loginScreen) refs.loginScreen.classList.add("hidden");
  if (refs.appScreen) refs.appScreen.classList.add("hidden");
  const el = document.createElement("div");
  el.id = "__authBoot";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.className =
    "login-viewport-min flex flex-col items-center justify-center gap-2 px-margin-mobile py-stack-md text-on-surface-variant";
  el.innerHTML =
    '<span class="material-symbols-rounded animate-pulse text-2xl text-primary">progress_activity</span><p class="text-sm">Carregando...</p>';
  const main = refs.loginScreen?.parentNode;
  if (main) main.insertBefore(el, refs.loginScreen);
}

(function authBootOnLoad() {
  showAuthBootScreen();
})();

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

/** Indicador discreto de estoque no catalogo da comanda. */
function formatProductStockHint(stock) {
  const n = Math.trunc(Number(stock) || 0);
  return `<span class="product-stock-hint shrink-0 text-[10px] font-medium tabular-nums text-on-surface-variant/70" title="Estoque atual">${n} un.</span>`;
}

function formatProductStockHintForCatalog(product) {
  if (!isStockControlEnabled()) return "";
  return formatProductStockHint(getProductStockDisplayQuantity(product));
}

function loadProducts() {
  return state.cache.products;
}

function saveProducts(products) {
  state.cache.products = products;
  void (async () => {
    for (const product of products) {
      if (product.id === undefined || product.id === null || product.id === "")
        continue;
      try {
        await upsertProductRemote(product);
      } catch (e) {
        console.error("[JANA] saveProducts", e);
      }
    }
  })();
}

function loadOrders() {
  return state.cache.commandas;
}

function saveOrders(orders) {
  state.cache.commandas = orders;
  void (async () => {
    for (const order of orders) {
      if (order.id === undefined || order.id === null || order.id === "")
        continue;
      try {
        await upsertCommandaRemote(order);
      } catch (e) {
        console.error("[JANA] saveOrders", e);
      }
    }
  })();
}

function loadClosedShiftsForHistory() {
  return loadAllClosedSessions();
}

function renderCashCloseHistoryOverlay() {
  if (!refs.cashCloseHistoryBody) return;
  const history = loadClosedShiftsForHistory();
  refs.cashCloseHistoryBody.innerHTML = history.length
    ? `<ul class="space-y-2">
        ${history
          .map((row) => {
            const snap = row.payload?.closeSnapshot || {};
            const sales = Array.isArray(snap.sales) ? snap.sales : [];
            const rowId = String(row.id);
            const isExpanded = state.cashCloseHistoryExpandedId === rowId;
            const refLabel = row.referenceDate
              ? row.referenceDate.split("-").reverse().join("/")
              : "";
            return `
          <li class="rounded-lg border border-outline-variant px-3 py-2 text-xs">
            <button type="button" class="cash-close-history-toggle w-full text-left" data-close-id="${rowId}">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="font-semibold text-on-surface">Caixa ${refLabel} · ${row.scheduledStart}${row.scheduledEnd && row.scheduledEnd !== row.scheduledStart ? ` – ${row.scheduledEnd}` : ""}${row.payload?.legacyDailyClose ? " (anterior)" : ""}</p>
                  <p class="text-on-surface-variant">Ativas: ${snap.activeOrdersCount != null ? snap.activeOrdersCount : "—"} • Bruto: ${formatCurrency(snap.totalBruto || 0)} • ${snap.finalizedOrdersCount ?? 0} fin.</p>
                  <p class="text-[10px] text-on-surface-variant">${row.endedAt ? new Date(row.endedAt).toLocaleString("pt-BR") : ""}</p>
                </div>
                <span class="text-[10px] font-bold uppercase ${isExpanded ? "text-primary" : "text-on-surface-variant"}">${isExpanded ? "Ocultar" : "Ver"}</span>
              </div>
            </button>
            ${
              isExpanded
                ? `<div class="mt-2 rounded-md bg-surface-container-low px-2 py-2">
                    <p class="text-[10px] font-semibold uppercase text-on-surface-variant">Vendas deste fechamento</p>
                    ${
                      sales.length
                        ? `
                        <ul class="mt-1 space-y-1">
                          ${sales
                            .map(
                              (sale) => `
                            <li class="rounded border border-outline-variant px-2 py-1">
                              <p class="font-semibold text-on-surface">${sale.customer || "Cliente sem nome"} • ${formatCurrency(sale.totalPaid || 0)}</p>
                              <p class="text-[10px] text-on-surface-variant">Itens: ${sale.itemsCount ?? 0} • Pagamento: ${(sale.paymentMethods || []).join(", ") || "Nao informado"}</p>
                            </li>`,
                            )
                            .join("")}
                        </ul>`
                        : "<p class='mt-1 text-[10px] text-on-surface-variant'>Sem detalhes de vendas neste fechamento.</p>"
                    }
                  </div>`
                : ""
            }
          </li>`;
          })
          .join("")}
      </ul>`
    : "<p class='text-sm text-on-surface-variant'>Nenhum fechamento salvo ainda.</p>";
}

function openCashCloseHistoryDialog() {
  if (!refs.cashCloseHistoryDialog) return;
  state.cashCloseHistoryExpandedId = null;
  renderCashCloseHistoryOverlay();
  refs.cashCloseHistoryDialog.classList.remove("hidden");
}

function closeCashCloseHistoryDialog() {
  refs.cashCloseHistoryDialog?.classList.add("hidden");
}

function loadConfig() {
  const fallback = {
    id: 1,
    useTables: false,
    useServiceFee: true,
    useStock: true,
    activeTheme: "blue-service",
    categories: [
      "Bebidas",
      "Lanches",
      "Porcoes",
      "Pratos",
      "Sobremesas",
      "Outros",
    ],
    prepCategories: [],
    paymentMethods: [
      { id: "card", name: "Cartao", active: true },
      { id: "cash", name: "Dinheiro", active: true },
      { id: "pix", name: "PIX", active: true },
      { id: "voucher", name: "Vale Ref.", active: true },
    ],
  };
  const config = state.cache.config || fallback;
  return {
    ...fallback,
    ...config,
    activeTheme: THEME_PRESETS[config.activeTheme]
      ? config.activeTheme
      : fallback.activeTheme,
    categories:
      Array.isArray(config.categories) && config.categories.length
        ? config.categories
        : fallback.categories,
    prepCategories: Array.isArray(config.prepCategories)
      ? config.prepCategories
      : fallback.prepCategories,
    paymentMethods:
      Array.isArray(config.paymentMethods) && config.paymentMethods.length
        ? config.paymentMethods
        : fallback.paymentMethods,
  };
}

function saveConfig(config) {
  state.cache.config = config;
  void upsertAppConfigRemote(config).catch((e) =>
    console.error("[JANA] saveConfig", e),
  );
}

function applyTheme() {
  const theme = state.config.activeTheme || "blue-service";
  document.documentElement.setAttribute("data-theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const themeColorByKey = {
      apple: "#0071e3",
      "blue-service": "#00234b",
      "dark-pro": "#13161c",
    };
    meta.setAttribute("content", themeColorByKey[theme] || "#fbf9fc");
  }
}

function updateHorizontalScrollHints(scroller, leftHint, rightHint) {
  if (!scroller || !leftHint || !rightHint) return;
  const maxScrollLeft = Math.max(
    0,
    scroller.scrollWidth - scroller.clientWidth,
  );
  const hasOverflow = maxScrollLeft > 2;
  const showLeft = hasOverflow && scroller.scrollLeft > 4;
  const showRight = hasOverflow && scroller.scrollLeft < maxScrollLeft - 4;
  leftHint.classList.toggle("show", showLeft);
  rightHint.classList.toggle("show", showRight);
}

/** Mede overflow depois do layout (painel visivel, botoes renderizados). */
function scheduleHorizontalScrollHints(updateFn) {
  requestAnimationFrame(() => {
    requestAnimationFrame(updateFn);
  });
}

function updateSettingsTabsHints() {
  updateHorizontalScrollHints(
    refs.settingsTabsScroll,
    refs.settingsTabsLeftHint,
    refs.settingsTabsRightHint,
  );
}

function updateCategoryTabsHints() {
  if (
    !refs.categoryTabsScroll ||
    !refs.categoryTabsLeftHint ||
    !refs.categoryTabsRightHint
  )
    return;
  updateHorizontalScrollHints(
    refs.categoryButtons,
    refs.categoryTabsLeftHint,
    refs.categoryTabsRightHint,
  );
}

function updateProductAdminCategoryTabsHints() {
  updateHorizontalScrollHints(
    refs.productAdminCategoryButtons,
    refs.productAdminCategoryTabsLeftHint,
    refs.productAdminCategoryTabsRightHint,
  );
}

function updateStockAdminCategoryTabsHints() {
  updateHorizontalScrollHints(
    refs.stockAdminCategoryButtons,
    refs.stockAdminCategoryTabsLeftHint,
    refs.stockAdminCategoryTabsRightHint,
  );
}

function refreshSettingsCategoryFilterHints() {
  if (state.selectedSettingsTab === "products") {
    scheduleHorizontalScrollHints(updateProductAdminCategoryTabsHints);
  }
  if (state.selectedSettingsTab === "inventory") {
    scheduleHorizontalScrollHints(updateStockAdminCategoryTabsHints);
  }
}

function isPendingLocalOrder() {
  return (
    state.pendingNewOrder != null && state.selectedOrderId === PENDING_ORDER_ID
  );
}

function getCurrentOrder() {
  if (isPendingLocalOrder()) return state.pendingNewOrder;
  return loadOrders().find(
    (order) => String(order.id) === String(state.selectedOrderId),
  );
}

function calculateOrderSubtotal(order) {
  const items = order.items || [];
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

/** Soma totalPaid de comandas finalizadas com closedAt na faixa de datas locais [fromYmd, toYmd] inclusive. */
function calculatePaidInDateRange(orders, fromYmd, toYmd) {
  if (!fromYmd || !toYmd) return 0;
  return orders
    .filter((order) => {
      if (normalizeOrderStatus(order.status) !== "Finalizado") return false;
      const day = localYmdFromIso(order.closedAt || order.createdAt);
      return day >= fromYmd && day <= toYmd;
    })
    .reduce((sum, order) => sum + (order.totalPaid || 0), 0);
}

function finalizedOrdersInLocalDateRange(orders, fromYmd, toYmd) {
  if (!fromYmd || !toYmd) return [];
  return orders.filter((order) => {
    if (normalizeOrderStatus(order.status) !== "Finalizado") return false;
    const day = localYmdFromIso(order.closedAt || order.createdAt);
    return day >= fromYmd && day <= toYmd;
  });
}

const WEEKDAY_LABELS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

/**
 * Distribui totalPaid entre as formas marcadas (rateio igual; 1 metodo = 100%).
 * @returns {Record<string, number>}
 */
function aggregatePaymentMethodShares(orders) {
  const map = Object.create(null);
  for (const order of orders) {
    const total = order.totalPaid || 0;
    const names = (order.paymentMethods || []).filter(Boolean);
    if (!names.length || total <= 0) continue;
    const share = total / names.length;
    for (const name of names) {
      map[name] = (map[name] || 0) + share;
    }
  }
  return map;
}

/**
 * Soma de qty por productId (fallback name) nos itens das comandas.
 * @returns {Array<{ key: string, name: string, qty: number, revenue: number }>}
 */
function aggregateTopProducts(orders, limit = 15) {
  const byKey = new Map();
  for (const order of orders) {
    for (const item of order.items || []) {
      const key =
        item.productId != null && item.productId !== ""
          ? `id:${item.productId}`
          : `name:${item.name || ""}`;
      const cur = byKey.get(key) || {
        name: item.name || key,
        qty: 0,
        revenue: 0,
      };
      cur.qty += item.qty || 0;
      cur.revenue += (item.price || 0) * (item.qty || 0);
      if (item.name) cur.name = item.name;
      byKey.set(key, cur);
    }
  }
  return [...byKey.values()].sort((a, b) => b.qty - a.qty).slice(0, limit);
}

/** Contagem de comandas e soma de faturamento por hora local (0-23) no instante de fechamento. */
function aggregatePeakHour(orders) {
  const counts = Array.from({ length: 24 }, () => 0);
  const revenue = Array.from({ length: 24 }, () => 0);
  for (const order of orders) {
    const iso = order.closedAt || order.createdAt;
    if (!iso) continue;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    const h = d.getHours();
    counts[h] += 1;
    revenue[h] += order.totalPaid || 0;
  }
  let maxIdx = 0;
  for (let i = 1; i < 24; i++) {
    if (counts[i] > counts[maxIdx]) maxIdx = i;
  }
  return {
    counts,
    revenue,
    peakHourIndex: counts.some((c) => c > 0) ? maxIdx : null,
  };
}

/** Contagem e faturamento por dia da semana local (0 = domingo). */
function aggregateWeekday(orders) {
  const counts = Array.from({ length: 7 }, () => 0);
  const revenue = Array.from({ length: 7 }, () => 0);
  for (const order of orders) {
    const iso = order.closedAt || order.createdAt;
    if (!iso) continue;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    const wd = d.getDay();
    counts[wd] += 1;
    revenue[wd] += order.totalPaid || 0;
  }
  let maxIdx = 0;
  for (let i = 1; i < 7; i++) {
    if (counts[i] > counts[maxIdx]) maxIdx = i;
  }
  return {
    counts,
    revenue,
    peakWeekdayIndex: counts.some((c) => c > 0) ? maxIdx : null,
  };
}

function paymentSharesSorted(map) {
  return Object.entries(map)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function categoryRequiresPrep(category) {
  return (state.config.prepCategories || []).includes(category);
}

function normalizeOrderStatus(status) {
  if (status === "Finalizado" || status === "Cancelada" || status === "Aberta")
    return status;
  // Compatibilidade com status legado.
  if (status === "Aguardando" || status === "Em curso") return "Aberta";
  return "Aberta";
}

function getOpenOrders() {
  return loadOrders().filter(
    (o) => normalizeOrderStatus(o.status) === "Aberta",
  );
}

function formatOpenOrdersCashCloseHint(maxNames = 4) {
  const open = getOpenOrders();
  if (!open.length) return "";
  const n = open.length;
  const names = open
    .map((o) => {
      const label = (o.customer || "").trim() || "Sem nome";
      const table =
        state.config.useTables && o.table ? ` · mesa ${o.table}` : "";
      return `${label}${table}`;
    })
    .slice(0, maxNames);
  const extra = n > maxNames ? ` e mais ${n - maxNames}` : "";
  const list = names.join(", ");
  const plural = n === 1 ? "comanda em aberto" : "comandas em aberto";
  return `Ainda ha ${n} ${plural}: ${list}${extra}. Finalize ou cancele no Inicio antes de fechar o caixa.`;
}

function deriveOrderStatus(order) {
  if (order.status === "Finalizado" || order.status === "Cancelada")
    return order.status;
  return "Aberta";
}

function formatTimeShort(isoDate) {
  if (!isoDate) return "";
  return new Date(isoDate).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatElapsedSince(isoDate) {
  if (!isoDate) return "";
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMin = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return `${h}h ${m}min`;
}

/** Cronometro mm:ss desde o instante ISO (exibe subida em tempo real). */
function formatElapsedClock(isoDate) {
  if (!isoDate) return "00:00";
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDurationFromSeconds(totalSec) {
  if (totalSec == null || Number.isNaN(totalSec)) return "";
  const sec = Math.max(0, Math.floor(totalSec));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}min ${s}s` : `${m}min`;
}

/** Garante lineId em cada linha da comanda (itens antigos). Retorna true se alterou. */
function ensureLineIds(order) {
  if (!order?.items?.length) return false;
  let changed = false;
  for (const item of order.items) {
    if (!item.lineId) {
      item.lineId = crypto.randomUUID();
      changed = true;
    }
  }
  return changed;
}

function computeServiceSeconds(requestedAt, deliveredAt) {
  if (!requestedAt || !deliveredAt) return null;
  const a = new Date(requestedAt).getTime();
  const b = new Date(deliveredAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 1000));
}

function syncOrderLineTimerElements() {
  document
    .querySelectorAll(".order-line-timer[data-requested-at]")
    .forEach((el) => {
      const iso = el.dataset.requestedAt;
      if (!iso) return;
      el.textContent = formatElapsedClock(iso);
    });
}

function syncOrderItemsTimerInterval() {
  if (orderItemsTimerInterval) {
    clearInterval(orderItemsTimerInterval);
    orderItemsTimerInterval = null;
  }
  const onDetail = state.currentView === "detail";
  const order = getCurrentOrder();
  const status = order ? normalizeOrderStatus(order.status) : "";
  const openOrder = onDetail && order && status === "Aberta";
  const hasRunning =
    openOrder &&
    (order.items || []).some(
      (item) => item.requiresPrep && item.requestedAt && !item.deliveredAt,
    );
  if (!hasRunning) return;
  orderItemsTimerInterval = window.setInterval(() => {
    if (state.currentView !== "detail") {
      syncOrderItemsTimerInterval();
      return;
    }
    syncOrderLineTimerElements();
  }, 1000);
}

function markLineDelivered(lineId) {
  if (!lineId) return;
  const order = getCurrentOrder();
  if (!order) return;
  const status = normalizeOrderStatus(order.status);
  if (status !== "Aberta") return;
  const item = order.items.find(
    (entry) => String(entry.lineId) === String(lineId),
  );
  if (!item || item.deliveredAt || !item.requiresPrep) return;
  item.deliveredAt = new Date().toISOString();
  item.serviceSeconds = computeServiceSeconds(
    item.requestedAt,
    item.deliveredAt,
  );

  if (isPendingLocalOrder()) {
    renderDashboard();
    renderOrderDetails();
    return;
  }
  saveOrders(loadOrders());
  renderDashboard();
  renderOrderDetails();
}

function formatOrderIdentification(order) {
  const customerName = order.customer?.trim() || "Cliente sem nome";
  if (state.config.useTables) {
    return `${customerName} - ${order.table || "Sem mesa"}`;
  }
  return customerName;
}

function formatOrderSubline(order) {
  const createdAt = new Date(order.createdAt).toLocaleString("pt-BR");
  if (state.config.useTables) {
    return `${order.table || "Sem mesa"} • ${createdAt}`;
  }
  return createdAt;
}

/** Data local YYYY-MM-DD (input type="date"). */
function todayLocalYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Converte instante ISO para data local YYYY-MM-DD. */
function localYmdFromIso(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Data usada para filtrar reabertura: fechamento, cancelamento ou criacao (fallback). */
function orderReopenEventYmd(order) {
  const st = normalizeOrderStatus(order.status);
  if (st === "Finalizado")
    return localYmdFromIso(order.closedAt || order.createdAt);
  if (st === "Cancelada")
    return localYmdFromIso(order.canceledAt || order.createdAt);
  return "";
}

function recordOrderReopenAudit(order, previousStatus) {
  const entry = {
    reopenedAt: new Date().toISOString(),
    reopenedBy: state.user?.email || state.user?.username || null,
    previousStatus,
    previousClosedAt: order.closedAt || null,
    previousCanceledAt: order.canceledAt || null,
    previousTotalPaid: order.totalPaid ?? null,
    previousPaymentMethods: Array.isArray(order.paymentMethods)
      ? [...order.paymentMethods]
      : [],
  };
  order.reopenHistory = [
    ...(Array.isArray(order.reopenHistory) ? order.reopenHistory : []),
    entry,
  ];
  order.lastReopenedAt = entry.reopenedAt;
}

function performReopenOrder(orderId) {
  const orders = loadOrders();
  const target = orders.find((o) => String(o.id) === String(orderId));
  if (!target) return false;
  const st = normalizeOrderStatus(target.status);
  if (st !== "Finalizado" && st !== "Cancelada") return false;
  recordOrderReopenAudit(target, st);
  target.status = "Aberta";
  delete target.closedAt;
  delete target.canceledAt;
  delete target.shiftId;
  if (st === "Finalizado") {
    target.totalPaid = 0;
    target.paymentMethods = [];
  }
  saveOrders(orders);
  return true;
}

function openReopenConfirmDialog(orderId) {
  if (!refs.reopenConfirmDialog || !refs.reopenConfirmAcceptButton) return;
  refs.reopenConfirmAcceptButton.dataset.orderId = String(orderId);
  refs.reopenConfirmDialog.showModal();
}

function setReopenShiftFeedback(type, text) {
  if (!refs.reopenShiftFeedback) return;
  refs.reopenShiftFeedback.textContent = text || "";
  refs.reopenShiftFeedback.className = `mt-2 min-h-[1rem] text-xs ${
    type === "err"
      ? "text-error"
      : type === "ok"
        ? "text-secondary"
        : type === "warn"
          ? "text-primary"
          : "text-on-surface-variant"
  }`;
}

function renderReopenShiftPanel() {
  if (!refs.reopenShiftSummary || !refs.reopenShiftUndoButton) return;
  const open = getOpenShift();
  const last = getLastClosedShift();
  const undoAllowed = canUndoLastShiftClose();
  if (open) {
    refs.reopenShiftSummary.innerHTML = `<p class="text-on-surface">Ha um caixa <strong>aberto</strong> (${formatShiftLabel(open)}). Feche-o em Relatorios antes de desfazer outro fechamento.</p>`;
  } else if (!last) {
    refs.reopenShiftSummary.innerHTML =
      "<p>Nenhum caixa fechado encontrado.</p>";
  } else {
    const ref = last.referenceDate
      ? last.referenceDate.split("-").reverse().join("/")
      : "—";
    const ended = last.endedAt ? formatDateTimeShort(last.endedAt) : "—";
    const opened = last.startedAt ? formatDateTimeShort(last.startedAt) : "—";
    refs.reopenShiftSummary.innerHTML = `
      <p><span class="font-semibold text-on-surface">Referencia:</span> ${ref}</p>
      <p class="mt-1"><span class="font-semibold text-on-surface">Abriu:</span> ${opened}</p>
      <p class="mt-1"><span class="font-semibold text-on-surface">Fechou:</span> ${ended}</p>`;
  }
  refs.reopenShiftUndoButton.disabled = !undoAllowed;
  refs.reopenShiftUndoButton.className = `mt-stack-sm h-touch-target-min w-full rounded-xl border text-sm font-bold ${
    !undoAllowed
      ? "cursor-not-allowed border-outline-variant/60 bg-surface-container-low/80 text-on-surface-variant/70"
      : state.reopenShiftPendingConfirm
        ? "border-error bg-error text-on-error"
        : "border-outline-variant bg-surface-container-low text-on-surface"
  }`;
  refs.reopenShiftUndoButton.textContent = state.reopenShiftPendingConfirm
    ? "Confirmar desfazer fechamento"
    : "Desfazer ultimo fechamento";
}

function renderReopenPanel() {
  renderReopenShiftPanel();
  if (!refs.reopenOrdersList) return;
  refs.reopenPanelFeedback.textContent = "";
  let dateVal = (refs.reopenFilterDateInput?.value || "").trim();
  if (!dateVal) {
    dateVal = todayLocalYmd();
    if (refs.reopenFilterDateInput) refs.reopenFilterDateInput.value = dateVal;
  }
  const orders = loadOrders();
  const matches = orders.filter((order) => {
    const st = normalizeOrderStatus(order.status);
    if (st !== "Finalizado" && st !== "Cancelada") return false;
    return orderReopenEventYmd(order) === dateVal;
  });
  if (!matches.length) {
    refs.reopenOrdersList.innerHTML =
      "<li class='rounded-lg border border-outline-variant bg-surface-container-high p-3 text-sm text-on-surface-variant'>Nenhuma comanda finalizada ou cancelada nesta data.</li>";
    return;
  }
  refs.reopenOrdersList.innerHTML = matches
    .map((order) => {
      const st = normalizeOrderStatus(order.status);
      const eventIso =
        st === "Finalizado"
          ? order.closedAt || order.createdAt
          : order.canceledAt || order.createdAt;
      const when = eventIso ? new Date(eventIso).toLocaleString("pt-BR") : "";
      const subtotal = calculateOrderSubtotal(order);
      const badge =
        st === "Finalizado"
          ? "bg-secondary-container text-on-secondary-container"
          : "bg-error-container text-error";
      return `
        <li class="rounded-lg border border-outline-variant p-3">
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="text-sm font-bold text-on-surface">${order.customer?.trim() || "Cliente sem nome"}</p>
              <p class="text-xs text-on-surface-variant">${when} • ${formatCurrency(subtotal)}</p>
            </div>
            <span class="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold ${badge}">${st}</span>
          </div>
          <button type="button" class="reopen-single-order-button mt-2 h-10 w-full rounded-lg border border-primary text-sm font-bold text-primary" data-order-id="${order.id}">Reabrir comanda</button>
        </li>
      `;
    })
    .join("");

  document.querySelectorAll(".reopen-single-order-button").forEach((btn) => {
    btn.addEventListener("click", () =>
      openReopenConfirmDialog(btn.dataset.orderId),
    );
  });
}

async function persistPendingOrderToServer() {
  const order = state.pendingNewOrder;
  if (!order) return;
  const orders = loadOrders();
  order.id = crypto.randomUUID();
  order.everHadItems = true;
  orders.unshift({ ...order });
  state.cache.commandas = orders;
  state.pendingNewOrder = null;
  state.selectedOrderId = order.id;
  saveOrders(orders);
}

function persistOrderTableFromDetail() {
  if (!state.config.useTables || !refs.orderTableInput) return;
  const order = getCurrentOrder();
  if (!order) return;
  const table = refs.orderTableInput.value.trim();
  if (isPendingLocalOrder()) {
    state.pendingNewOrder.table = table;
    return;
  }
  const orders = loadOrders();
  const target = orders.find((entry) => String(entry.id) === String(order.id));
  if (!target) return;
  target.table = table;
  saveOrders(orders);
}

async function createNewOrderAndOpen() {
  if (!(await ensureOpenShiftAuto())) return;

  state.pendingNewOrder = {
    table: "",
    customer: "",
    status: "Aberta",
    items: [],
    paymentMethods: [],
    serviceFeePercent: 10,
    totalPaid: 0,
    createdAt: new Date().toISOString(),
    everHadItems: false,
  };
  state.selectedOrderId = PENDING_ORDER_ID;
  state.currentView = "detail";
  state.detailAction = "add";
  state.cancelConfirmOpen = false;
  renderAll();
}

function setLoggedUser(user) {
  state.user = user;
}

function clearLoggedUser() {
  state.user = null;
  abandonPendingOrder();
  state.selectedOrderId = null;
}

function renderAuth() {
  hideAuthBootScreen();
  applyTheme();
  if (state.user) {
    refs.loginScreen.classList.add("hidden");
    refs.appScreen.classList.remove("hidden");
    refs.currentUserLabel.textContent = `${state.user.username} (${state.user.role})`;
    if (state.selectedOrderId === PENDING_ORDER_ID) abandonPendingOrder();
    state.currentView = "main";
    renderAll();
  } else {
    refs.loginScreen.classList.remove("hidden");
    refs.appScreen.classList.add("hidden");
  }
}

function renderShiftBar() {
  if (!refs.shiftBar) return;
  const shift = getOpenShift();
  if (shift) {
    refs.shiftBar.innerHTML = `
      <div class="rounded-xl border border-outline-variant bg-primary-fixed px-3 py-2.5">
        <p class="text-[10px] font-bold uppercase tracking-wide text-on-primary-fixed-variant">Caixa aberto</p>
        <p class="text-sm font-extrabold text-primary">${formatShiftLabel(shift)}</p>
        <p class="mt-0.5 text-[10px] text-on-surface-variant">Vendas entram aqui ate voce fechar o caixa.${shift.payload?.inferredFromOpenOrders ? " Horario da primeira comanda aberta (legado nao gravava abertura)." : ""}</p>
      </div>`;
    if (refs.openShiftButton) refs.openShiftButton.classList.add("hidden");
  } else {
    refs.shiftBar.innerHTML = `
      <div class="rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2.5">
        <p class="text-sm font-semibold text-on-surface">Caixa fechado</p>
        <p class="mt-0.5 text-[10px] text-on-surface-variant">Abra o caixa quando comecar a operar.</p>
      </div>`;
    if (refs.openShiftButton) refs.openShiftButton.classList.remove("hidden");
  }
}

function renderDashboard() {
  renderShiftBar();
  const orders = loadOrders();
  const shift = getOpenShift();
  const dashboardOrders = ordersForDashboard(orders, shift);
  const finalizedInShift = shift ? ordersFinalizedInShift(orders, shift) : [];
  const active = orders.filter(
    (order) => normalizeOrderStatus(order.status) === "Aberta",
  );
  if (refs.dailySalesCount)
    refs.dailySalesCount.textContent = String(finalizedInShift.length);
  refs.activeOrdersCount.textContent = String(active.length);
  refs.dailyRevenueValue.textContent = formatCurrency(
    finalizedInShift.reduce((s, o) => s + (o.totalPaid || 0), 0),
  );

  const filtered = dashboardOrders.filter((order) => {
    if (state.selectedFilter === "all") return true;
    return normalizeOrderStatus(order.status) === state.selectedFilter;
  });

  if (!filtered.length) {
    refs.ordersList.innerHTML =
      "<li class='rounded-xl border border-outline-variant bg-surface-container-lowest p-4 text-sm text-on-surface-variant'>Nenhuma comanda neste filtro.</li>";
    return;
  }

  refs.ordersList.innerHTML = filtered
    .map((order) => {
      const subtotal = calculateOrderSubtotal(order);
      const status = normalizeOrderStatus(order.status);
      const badgeColor =
        status === "Finalizado"
          ? "bg-secondary-container text-on-secondary-container"
          : status === "Cancelada"
            ? "bg-error-container text-error"
            : "bg-primary-fixed text-on-primary-fixed-variant";
      const isViewOnly = status === "Finalizado" || status === "Cancelada";
      const canFinalize = status === "Aberta" && order.items?.length;
      const actionButtons = isViewOnly
        ? `<button type="button" class="order-view-button mt-3 h-touch-target-min w-full rounded-xl bg-primary text-sm font-bold text-on-primary" data-order-id="${order.id}">Visualizar</button>`
        : `<div class="mt-3 grid grid-cols-2 gap-2">
            <button type="button" class="order-open-button h-touch-target-min w-full rounded-xl bg-primary text-sm font-bold text-on-primary" data-order-id="${order.id}">Abrir</button>
            <button type="button" class="order-finalize-button h-touch-target-min w-full rounded-xl border border-outline-variant bg-surface text-sm font-bold text-primary ${canFinalize ? "" : "opacity-50"}" data-order-id="${order.id}" ${canFinalize ? "" : "disabled"}>Finalizar</button>
          </div>`;
      return `
        <li class="rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm">
          <div class="flex items-start justify-between">
            <div>
              <p class="text-base font-bold text-primary">${order.customer?.trim() || "Cliente sem nome"}</p>
              <p class="text-xs text-on-surface-variant">${formatOrderSubline(order)}</p>
            </div>
            <span class="rounded-lg px-2 py-1 text-xs font-semibold ${badgeColor}">${status}</span>
          </div>
          <p class="mt-3 text-sm font-extrabold text-primary">${formatCurrency(subtotal)}</p>
          ${actionButtons}
        </li>
      `;
    })
    .join("");

  document
    .querySelectorAll(".order-open-button, .order-view-button")
    .forEach((button) => {
      button.addEventListener("click", () => {
        void openDetailDialog(button.dataset.orderId);
      });
    });
  document.querySelectorAll(".order-finalize-button").forEach((button) => {
    button.addEventListener(
      "click",
      () => void beginFinalizeFlowForOrderId(button.dataset.orderId),
    );
  });
}

function renderHeaderSettingsButton() {
  if (!refs.openSettingsButton) return;
  const settingsActive =
    state.currentView === "main" && state.selectedTab === "settingsTab";
  refs.openSettingsButton.className = settingsActive
    ? "header-settings-button header-settings-button--active flex h-11 w-11 items-center justify-center rounded-lg border border-outline-variant bg-primary-container text-on-primary-container transition"
    : "header-settings-button flex h-11 w-11 items-center justify-center rounded-lg border border-outline-variant text-on-surface transition";
  refs.openSettingsButton.setAttribute(
    "aria-pressed",
    settingsActive ? "true" : "false",
  );
}

function renderBottomTabs() {
  refs.tabPanels.forEach((panel) => panel.classList.add("hidden"));
  document.querySelector(`#${state.selectedTab}`)?.classList.remove("hidden");

  refs.bottomTabs.forEach((tab) => {
    const selected = tab.dataset.tab === state.selectedTab;
    tab.className = selected
      ? "bottom-tab bottom-tab--active flex flex-1 items-center justify-center rounded-[0.875rem] bg-primary-container text-on-primary-container transition"
      : "bottom-tab flex flex-1 items-center justify-center rounded-[0.875rem] text-on-surface-variant transition hover:bg-surface-container-high/60";
    tab.setAttribute("aria-selected", selected ? "true" : "false");
  });

  renderHeaderSettingsButton();
}

function renderView() {
  const onMain = state.currentView === "main";
  const onDetail = state.currentView === "detail";
  const onCheckout = state.currentView === "checkout";

  refs.mainContent.classList.toggle("hidden", !onMain);
  refs.appHeader.classList.toggle("hidden", !onMain);
  refs.appBottomNav.classList.toggle("hidden", !onMain);
  refs.detailDialog.classList.toggle("hidden", !onDetail);
  refs.checkoutDialog.classList.toggle("hidden", !onCheckout);
  syncOrderItemsTimerInterval();
}

function renderProductCategoryOptions() {
  const categories = state.config.categories || [];
  const current = refs.productCategoryInput.value;
  refs.productCategoryInput.innerHTML = [
    "<option value=''>Selecione uma categoria</option>",
    ...categories.map(
      (category) => `<option value="${category}">${category}</option>`,
    ),
  ].join("");
  if (current && categories.includes(current)) {
    refs.productCategoryInput.value = current;
  }
}

function renderSettings() {
  refs.settingsPanels.forEach((panel) => panel.classList.add("hidden"));
  const panelMap = {
    products: document.querySelector("#productsSettingsPanel"),
    inventory: document.querySelector("#inventorySettingsPanel"),
    operation: document.querySelector("#operationSettingsPanel"),
    categories: document.querySelector("#categoriesSettingsPanel"),
    payments: document.querySelector("#paymentsSettingsPanel"),
    reopen: document.querySelector("#reopenSettingsPanel"),
    theme: document.querySelector("#themeSettingsPanel"),
  };
  panelMap[state.selectedSettingsTab]?.classList.remove("hidden");
  refs.settingsTabButtons.forEach((button) => {
    const selected = button.dataset.settingsTab === state.selectedSettingsTab;
    button.className = selected
      ? "settings-tab-button h-10 flex-1 rounded-full bg-primary-container px-3 text-xs font-bold text-on-primary-container"
      : "settings-tab-button h-10 flex-1 rounded-full bg-surface-container-high px-3 text-xs font-bold text-on-surface-variant";
  });
  updateSettingsTabsHints();
  scheduleHorizontalScrollHints(updateSettingsTabsHints);
  refreshSettingsCategoryFilterHints();

  refs.tableModeToggle.checked = !!state.config.useTables;
  refs.serviceFeeToggle.checked = !!state.config.useServiceFee;
  refs.stockModeToggle.checked = isStockControlEnabled();
  refs.serviceFeeField?.classList.toggle("hidden", !state.config.useServiceFee);
  if (!isStockControlEnabled() && state.selectedSettingsTab === "inventory") {
    state.selectedSettingsTab = "operation";
  }
  syncStockControlDependentUi();
  renderProductCategoryOptions();

  refs.categoriesList.innerHTML = (state.config.categories || [])
    .map(
      (category) => `
      <li class="flex items-center justify-between rounded-lg border border-outline-variant px-3 py-2">
        <span class="text-sm font-semibold text-on-surface">${category}</span>
        <button class="delete-category-button h-8 rounded-md border border-error-container bg-error-container px-2 text-xs font-bold text-error" data-category="${category}">Excluir</button>
      </li>
    `,
    )
    .join("");

  document.querySelectorAll(".delete-category-button").forEach((button) => {
    button.addEventListener("click", () =>
      deleteCategory(button.dataset.category),
    );
  });

  refs.paymentMethodsSettingsList.innerHTML = (
    state.config.paymentMethods || []
  )
    .map(
      (method) => `
      <li class="flex items-center justify-between gap-2 rounded-lg border border-outline-variant px-3 py-2">
        <div class="flex items-center gap-2">
          <input class="payment-method-active-toggle h-4 w-4" type="checkbox" data-method-id="${method.id}" ${method.active ? "checked" : ""}>
          <span class="text-sm font-semibold text-on-surface">${method.name}</span>
        </div>
        <button class="delete-payment-method-button h-8 rounded-md border border-error-container bg-error-container px-2 text-xs font-bold text-error" data-method-id="${method.id}">Excluir</button>
      </li>
    `,
    )
    .join("");

  document
    .querySelectorAll(".payment-method-active-toggle")
    .forEach((toggle) => {
      toggle.addEventListener("change", () => {
        const target = state.config.paymentMethods.find(
          (method) => method.id === toggle.dataset.methodId,
        );
        if (!target) return;
        target.active = toggle.checked;
        saveConfig(state.config);
        renderCheckoutPaymentMethods();
      });
    });
  document
    .querySelectorAll(".delete-payment-method-button")
    .forEach((button) => {
      button.addEventListener("click", () =>
        deletePaymentMethod(button.dataset.methodId),
      );
    });

  refs.activeThemeLabel.textContent = `Tema ativo: ${THEME_PRESETS[state.config.activeTheme]?.label || "Blue Service"}`;
  refs.themePresetList.innerHTML = Object.entries(THEME_PRESETS)
    .map(
      ([key, preset]) => `
      <button class="theme-preset-button rounded-xl border p-2 text-left ${state.config.activeTheme === key ? "border-outline bg-primary-container text-on-primary-container" : "border-outline-variant bg-surface text-on-surface"}" data-theme-key="${key}">
        <div class="theme-mini-card relative overflow-hidden rounded-lg border border-outline-variant p-2" data-theme-preview="${key}">
          <div class="mb-2 h-2 w-16 rounded-full bg-primary"></div>
          <div class="space-y-1">
            <div class="h-2 w-full rounded bg-surface-container-high"></div>
            <div class="h-2 w-4/5 rounded bg-surface-container-high"></div>
          </div>
          <div class="mt-2 flex gap-1">
            <div class="h-5 w-12 rounded bg-primary"></div>
            <div class="h-5 w-10 rounded border border-outline-variant bg-surface"></div>
          </div>
        </div>
        <p class="mt-2 text-sm font-bold">${preset.label}</p>
        <p class="text-xs opacity-80">${preset.description}</p>
      </button>
    `,
    )
    .join("");
  refs.themePresetList.querySelectorAll(".theme-mini-card").forEach((card) => {
    card.setAttribute(
      "data-theme",
      card.dataset.themePreview || "blue-service",
    );
  });
  document.querySelectorAll(".theme-preset-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.config.activeTheme = button.dataset.themeKey;
      saveConfig(state.config);
      applyTheme();
      renderSettings();
    });
  });

  if (state.selectedSettingsTab === "reopen") {
    renderReopenPanel();
  }
  if (state.selectedSettingsTab === "inventory") {
    renderStockAdmin();
  }
}

function productCategoryFilterOptions() {
  const configuredCategories = (state.config.categories || []).filter(Boolean);
  const productCategories = loadProducts()
    .map((product) => product.category)
    .filter(Boolean);
  return ["Todas", ...new Set([...configuredCategories, ...productCategories])];
}

function renderProductAdminCategoryFilters() {
  if (!refs.productAdminCategoryButtons) return;
  const categories = productCategoryFilterOptions();
  if (!categories.includes(state.productAdminCategoryFilter)) {
    state.productAdminCategoryFilter = "Todas";
  }
  refs.productAdminCategoryButtons.innerHTML = categories
    .map(
      (category) => `
      <button type="button" class="product-admin-category-filter h-10 shrink-0 whitespace-nowrap rounded-full px-3 text-xs font-bold ${category === state.productAdminCategoryFilter ? "bg-primary-container text-on-primary-container" : "bg-surface-container-high text-on-surface-variant"}" data-category="${category}">
        ${category}
      </button>`,
    )
    .join("");
  refreshSettingsCategoryFilterHints();
}

function renderProductAdmin() {
  renderProductAdminCategoryFilters();
  const allProducts = loadProducts();
  const products = allProducts.filter(
    (product) =>
      state.productAdminCategoryFilter === "Todas" ||
      product.category === state.productAdminCategoryFilter,
  );

  if (!allProducts.length) {
    refs.productsList.innerHTML =
      "<li class='rounded-xl border border-outline-variant bg-surface-container-lowest p-4 text-sm text-on-surface-variant'>Nenhum produto cadastrado.</li>";
    return;
  }

  if (!products.length) {
    refs.productsList.innerHTML = `<li class='rounded-xl border border-outline-variant bg-surface-container-lowest p-4 text-sm text-on-surface-variant'>Nenhum produto em "${state.productAdminCategoryFilter}".</li>`;
    return;
  }

  refs.productsList.innerHTML = products
    .map(
      (product) => `
      <li class="rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm">
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="text-sm font-bold text-primary">${product.name}${product.isSpecial && isStockControlEnabled() ? ' <span class="text-[10px] font-bold uppercase text-secondary">Especial</span>' : ""}</p>
            <p class="text-xs text-on-surface-variant">${product.category}</p>
            <p class="mt-1 text-sm font-extrabold text-primary">${formatCurrency(product.price)}</p>
          </div>
          <div class="flex gap-2">
            <button class="product-edit-button h-10 rounded-lg border border-outline-variant px-3 text-xs font-semibold" data-product-id="${product.id}">Editar</button>
            <button class="product-delete-button h-10 rounded-lg border border-error-container bg-error-container px-3 text-xs font-semibold text-error" data-product-id="${product.id}">Excluir</button>
          </div>
        </div>
      </li>
    `,
    )
    .join("");

  document.querySelectorAll(".product-edit-button").forEach((button) => {
    button.addEventListener("click", () =>
      fillProductForm(button.dataset.productId),
    );
  });

  document.querySelectorAll(".product-delete-button").forEach((button) => {
    button.addEventListener("click", () =>
      deleteProduct(button.dataset.productId),
    );
  });

  syncStockControlDependentUi();
}

function renderStockAdminCategoryFilters() {
  if (!refs.stockAdminCategoryButtons) return;
  const categories = productCategoryFilterOptions();
  if (!categories.includes(state.stockAdminCategoryFilter)) {
    state.stockAdminCategoryFilter = "Todas";
  }
  refs.stockAdminCategoryButtons.innerHTML = categories
    .map(
      (category) => `
      <button type="button" class="stock-admin-category-filter h-10 shrink-0 whitespace-nowrap rounded-full px-3 text-xs font-bold ${category === state.stockAdminCategoryFilter ? "bg-primary-container text-on-primary-container" : "bg-surface-container-high text-on-surface-variant"}" data-category="${category}">
        ${category}
      </button>`,
    )
    .join("");
  refreshSettingsCategoryFilterHints();
}

function renderStockAdmin() {
  if (!refs.stockProductsList) return;
  renderStockAdminCategoryFilters();
  const allProducts = loadProducts()
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const products = allProducts.filter(
    (product) =>
      state.stockAdminCategoryFilter === "Todas" ||
      product.category === state.stockAdminCategoryFilter,
  );

  if (!allProducts.length) {
    refs.stockProductsList.innerHTML =
      "<li class='rounded-xl border border-outline-variant bg-surface-container-lowest p-4 text-sm text-on-surface-variant'>Nenhum produto cadastrado.</li>";
    return;
  }

  if (!products.length) {
    refs.stockProductsList.innerHTML = `<li class='rounded-xl border border-outline-variant bg-surface-container-lowest p-4 text-sm text-on-surface-variant'>Nenhum produto em "${state.stockAdminCategoryFilter}".</li>`;
    return;
  }

  refs.stockProductsList.innerHTML = products
    .map((product) => {
      if (product.isSpecial) {
        const hint =
          normalizeStockComponentIds(product).length > 0
            ? "Ajuste o estoque dos insumos vinculados."
            : "Configure os insumos no cadastro do produto.";
        const displayQty = getProductStockDisplayQuantity(product);
        const displayProduct = product.stockDisplayProductId
          ? findProductById(product.stockDisplayProductId)
          : null;
        const displayNote = displayProduct
          ? ` (insumo: ${displayProduct.name})`
          : normalizeStockComponentIds(product).length > 0
            ? " (menor saldo entre os insumos)"
            : "";
        return `
      <li class="rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm">
        <div class="flex items-start justify-between gap-2">
          <p class="text-sm font-bold text-primary">${product.name} <span class="text-[10px] font-bold uppercase text-secondary">Especial</span></p>
          ${formatProductStockHint(displayQty)}
        </div>
        <p class="text-xs text-on-surface-variant">${product.category}</p>
        <p class="mt-1 text-[11px] text-on-surface-variant">Possivel montar${displayNote}</p>
        <p class="mt-2 text-xs text-on-surface-variant">${hint}</p>
      </li>`;
      }
      const stock = Math.trunc(Number(product.stock) || 0);
      return `
      <li class="stock-product-row rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm" data-product-id="${product.id}">
        <p class="text-sm font-bold text-primary">${product.name}</p>
        <p class="text-xs text-on-surface-variant">${product.category}</p>
        <div class="mt-2 grid gap-2 sm:grid-cols-2">
          <label class="block">
            <span class="mb-1 block text-[11px] font-bold uppercase text-on-surface-variant">Estoque atual</span>
            <input type="number" step="1" class="stock-current-input h-touch-target-min w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 text-sm font-bold" value="${stock}">
          </label>
          <div class="flex items-end">
            <button type="button" class="stock-save-one-button h-touch-target-min w-full rounded-lg bg-primary text-sm font-bold text-on-primary" data-product-id="${product.id}">Salvar</button>
          </div>
        </div>
        <div class="mt-2 flex flex-wrap items-end gap-2">
          <label class="min-w-0 flex-1">
            <span class="mb-1 block text-[11px] font-bold uppercase text-on-surface-variant">Adicionar (+)</span>
            <input type="number" step="1" min="0" placeholder="10" class="stock-add-input h-touch-target-min w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 text-sm" value="">
          </label>
          <button type="button" class="stock-add-button h-touch-target-min shrink-0 rounded-lg border border-outline-variant bg-surface-container-high px-4 text-lg font-bold text-primary" title="Somar ao estoque" data-product-id="${product.id}">+</button>
        </div>
      </li>`;
    })
    .join("");
}

async function saveStockForProductId(productId, quantity) {
  if (!isStockControlEnabled()) return false;
  const qty = Math.trunc(Number(quantity));
  if (Number.isNaN(qty)) return false;
  setProductStockLocal(productId, qty);
  try {
    await setProductStockRemote(productId, qty);
    return true;
  } catch (e) {
    console.error("[JANA] saveStock", e);
    return false;
  }
}

async function applyStockIncrementFromRow(rowEl) {
  if (!isStockControlEnabled()) return false;
  const productId = rowEl?.dataset?.productId;
  if (!productId) return false;
  const addInput = rowEl.querySelector(".stock-add-input");
  const addVal = Math.trunc(Number(addInput?.value));
  if (!addVal || Number.isNaN(addVal)) return false;
  const next = getProductStock(productId) + addVal;
  setProductStockLocal(productId, next);
  try {
    await adjustProductStockRemote(productId, addVal);
    if (addInput) addInput.value = "";
    const currentInput = rowEl.querySelector(".stock-current-input");
    if (currentInput) currentInput.value = String(next);
    return true;
  } catch (e) {
    console.error("[JANA] stock increment", e);
    return false;
  }
}

function bindStockAdminInteractionsOnce() {
  const list = refs.stockProductsList;
  if (!list || list.dataset.boundStock === "1") return;
  list.dataset.boundStock = "1";

  list.addEventListener("click", (e) => {
    const row = e.target.closest(".stock-product-row");
    if (!row) return;
    const productId = row.dataset.productId;

    if (e.target.closest(".stock-save-one-button")) {
      void (async () => {
        const input = row.querySelector(".stock-current-input");
        const ok = await saveStockForProductId(productId, input?.value);
        if (refs.stockAdminFeedback) {
          refs.stockAdminFeedback.textContent = ok
            ? "Estoque salvo."
            : "Nao foi possivel salvar o estoque.";
          refs.stockAdminFeedback.className = ok
            ? "mt-2 min-h-[1rem] text-xs text-on-surface-variant"
            : "mt-2 min-h-[1rem] text-xs text-error";
        }
      })();
      return;
    }

    if (e.target.closest(".stock-add-button")) {
      void (async () => {
        const ok = await applyStockIncrementFromRow(row);
        if (refs.stockAdminFeedback) {
          refs.stockAdminFeedback.textContent = ok
            ? "Unidades adicionadas."
            : "Informe um valor em Adicionar (+).";
          refs.stockAdminFeedback.className = ok
            ? "mt-2 min-h-[1rem] text-xs text-on-surface-variant"
            : "mt-2 min-h-[1rem] text-xs text-error";
        }
      })();
    }
  });

  refs.stockSaveAllButton?.addEventListener("click", () => {
    void (async () => {
      const rows = [...list.querySelectorAll(".stock-product-row")];
      let saved = 0;
      for (const row of rows) {
        const productId = row.dataset.productId;
        const input = row.querySelector(".stock-current-input");
        if (await saveStockForProductId(productId, input?.value)) saved += 1;
      }
      if (refs.stockAdminFeedback) {
        refs.stockAdminFeedback.textContent =
          saved === rows.length
            ? `Estoque de ${saved} produto(s) salvo.`
            : `Salvos ${saved} de ${rows.length}. Verifique a conexao.`;
        refs.stockAdminFeedback.className =
          saved === rows.length
            ? "mt-2 min-h-[1rem] text-xs text-on-surface-variant"
            : "mt-2 min-h-[1rem] text-xs text-error";
      }
    })();
  });
}

function renderCategoryOptions() {
  if (!refs.categoryButtons) return;
  const categories = productCategoryFilterOptions();
  if (!categories.includes(state.selectedCategory)) {
    state.selectedCategory = "Todas";
  }
  refs.categoryButtons.innerHTML = categories
    .map(
      (category) => `
      <button class="category-filter-button h-10 whitespace-nowrap rounded-full px-3 text-xs font-bold ${category === state.selectedCategory ? "bg-primary-container text-on-primary-container" : "bg-surface-container-high text-on-surface-variant"}" data-category="${category}">
        ${category}
      </button>
    `,
    )
    .join("");
  document.querySelectorAll(".category-filter-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedCategory = button.dataset.category;
      renderCategoryOptions();
      renderOrderDetails();
    });
  });
  updateCategoryTabsHints();
}

function renderOrderDetails() {
  const order = getCurrentOrder();
  if (!order) return;
  const products = loadProducts();

  if (ensureLineIds(order) && !isPendingLocalOrder()) {
    saveOrders(loadOrders());
  }

  refs.detailTitle.textContent = formatOrderIdentification(order);
  refs.detailStatus.textContent = `Status: ${normalizeOrderStatus(order.status)}`;
  refs.detailCustomerInput.value = order.customer || "";
  refs.detailCustomerFeedback.textContent = "";

  const launchMode = state.detailAction === "add";
  const status = normalizeOrderStatus(order.status);
  const isLocked = status === "Finalizado" || status === "Cancelada";
  if (refs.detailCustomerHint) {
    if (isLocked) {
      refs.detailCustomerHint.textContent =
        status === "Finalizado"
          ? "Comanda finalizada — apenas visualização."
          : "Comanda cancelada — apenas visualização.";
    } else {
      refs.detailCustomerHint.textContent = launchMode
        ? "Depois de lançar os itens, informe o nome e use Confirmar."
        : "Visualização da comanda — edite o nome aqui se precisar.";
    }
  }
  if (
    refs.detailCustomerSection &&
    refs.detailCustomerSlotTop &&
    refs.detailCustomerSlotBottom
  ) {
    if (launchMode) {
      refs.detailCustomerSlotBottom.appendChild(refs.detailCustomerSection);
    } else {
      refs.detailCustomerSlotTop.appendChild(refs.detailCustomerSection);
    }
    refs.detailCustomerSlotTop.classList.toggle("hidden", launchMode);
    refs.detailCustomerSlotBottom.classList.toggle("hidden", !launchMode);
  }

  if (refs.orderTableGroup) {
    refs.orderTableGroup.classList.toggle("hidden", !state.config.useTables);
  }
  if (refs.orderTableInput) {
    refs.orderTableInput.value = state.config.useTables
      ? order.table || ""
      : "";
    refs.orderTableInput.disabled = isLocked;
    refs.orderTableInput.readOnly = isLocked;
  }
  if (refs.detailCustomerInput) {
    refs.detailCustomerInput.disabled = isLocked;
    refs.detailCustomerInput.readOnly = isLocked;
  }
  refs.saveCustomerButton?.classList.toggle("hidden", isLocked);
  refs.confirmDetailButton?.classList.toggle("hidden", isLocked);
  refs.addFlowContent.classList.toggle(
    "hidden",
    state.detailAction !== "add" || isLocked,
  );
  refs.cancelConfirmBox.classList.toggle("hidden", !state.cancelConfirmOpen);
  refs.openCancelFlowButton.classList.toggle("hidden", isLocked);
  if (!isLocked) {
    refs.openCancelFlowButton.disabled = false;
    refs.openCancelFlowButton.className =
      "mt-2 h-touch-target-min w-full rounded-xl border border-error-container bg-surface text-sm font-bold text-error shadow-sm transition";
  }
  if (refs.productSearchInput) {
    refs.productSearchInput.disabled = isLocked;
  }

  const filteredProducts = products.filter((product) => {
    const byCategory =
      state.selectedCategory === "Todas" ||
      product.category === state.selectedCategory;
    const byName = product.name
      .toLowerCase()
      .includes(state.productSearch.toLowerCase());
    return byCategory && byName;
  });

  refs.availableProductsList.innerHTML = filteredProducts.length
    ? filteredProducts
        .map(
          (product) => `
        <li class="rounded-xl border border-outline-variant/80 bg-surface-container-lowest/50 p-2">
          <div class="flex items-start justify-between gap-2">
            <p class="min-w-0 flex-1 text-sm font-semibold leading-snug text-on-surface">${product.name}</p>
            ${formatProductStockHintForCatalog(product)}
          </div>
          <p class="mt-0.5 text-xs text-on-surface-variant">${product.category} • ${formatCurrency(product.price)}</p>
          <button type="button" class="add-product-button mt-2 h-10 w-full select-none rounded-lg bg-primary text-sm font-semibold text-on-primary shadow-sm" data-product-id="${product.id}">Adicionar</button>
        </li>
      `,
        )
        .join("")
    : "<li class='rounded-xl border border-slate-200 p-3 text-sm text-slate-500'>Nenhum produto encontrado.</li>";

  const items = order.items || [];
  const itemsHtml = items.length
    ? items
        .map((item, index) => {
          const showTimer =
            item.requiresPrep &&
            item.requestedAt &&
            !item.deliveredAt &&
            !isLocked;
          const waitLabel =
            item.requiresPrep && item.deliveredAt && item.requestedAt
              ? `Entregue ${formatTimeShort(item.deliveredAt)}${
                  item.serviceSeconds != null
                    ? ` • espera ${formatDurationFromSeconds(item.serviceSeconds)}`
                    : ""
                }`
              : item.requiresPrep && item.deliveredAt
                ? `Entregue ${formatTimeShort(item.deliveredAt)}`
                : "";
          const showDeliverBtn =
            !isLocked &&
            item.requiresPrep &&
            item.requestedAt &&
            !item.deliveredAt;
          const lineIdAttr = item.lineId
            ? ` data-line-id="${item.lineId}"`
            : "";
          return `
        <li class="rounded-xl border border-slate-200 p-2">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold">${item.name}</p>
              <p class="text-xs text-slate-500">${formatCurrency(item.price)} cada</p>
              ${
                showTimer
                  ? `<p class="order-line-timer mt-0.5 text-[11px] tabular-nums tracking-tight text-on-surface-variant"${lineIdAttr} data-requested-at="${item.requestedAt}">${formatElapsedClock(
                      item.requestedAt,
                    )}</p>`
                  : ""
              }
              ${
                item.requiresPrep && item.deliveredAt
                  ? `<p class="mt-0.5 text-[11px] text-on-surface-variant">${waitLabel}</p>`
                  : item.requiresPrep && item.requestedAt && !showTimer
                    ? `<p class="mt-0.5 text-[11px] text-on-surface-variant">Pedido às ${formatTimeShort(item.requestedAt)}</p>`
                    : ""
              }
            </div>
            <div class="flex shrink-0 flex-col items-end gap-1">
              ${
                showDeliverBtn
                  ? `<button type="button" class="mark-delivered-button text-[11px] font-semibold text-primary underline decoration-primary/40 underline-offset-2" data-line-id="${item.lineId}">Entregue</button>`
                  : ""
              }
              ${
                isLocked
                  ? `<span class="text-sm font-bold text-on-surface-variant">Qtd. ${item.qty}</span>`
                  : `<div class="flex items-center gap-2">
                <button type="button" class="qty-minus h-10 w-10 rounded-lg border border-slate-300 text-lg font-bold" data-index="${index}">-</button>
                <span class="w-6 text-center text-sm font-bold">${item.qty}</span>
                <button type="button" class="qty-plus h-10 w-10 rounded-lg border border-slate-300 text-lg font-bold" data-index="${index}">+</button>
              </div>`
              }
            </div>
          </div>
        </li>`;
        })
        .join("")
    : "<li class='rounded-xl border border-slate-200 p-3 text-sm text-slate-500'>Nenhum item lancado.</li>";
  refs.orderItemsList.innerHTML = itemsHtml;
  if (status === "Finalizado" && order.totalPaid != null) {
    refs.orderSubtotalLabel.textContent = `Total pago: ${formatCurrency(order.totalPaid)}`;
  } else {
    refs.orderSubtotalLabel.textContent = `Subtotal: ${formatCurrency(calculateOrderSubtotal(order))}`;
  }

  syncOrderLineTimerElements();
  syncOrderItemsTimerInterval();
}

function renderCheckoutSummary() {
  const order = getCurrentOrder();
  if (!order) return;
  const subtotal = calculateOrderSubtotal(order);
  const feePercent = state.config.useServiceFee
    ? Number(refs.serviceFeeInput.value) || 0
    : 0;
  const feeValue = subtotal * (feePercent / 100);
  const total = subtotal + feeValue;

  refs.checkoutSummary.innerHTML = `
    <p class="flex justify-between text-sm"><span>Subtotal</span><span class="font-semibold">${formatCurrency(subtotal)}</span></p>
    <p class="flex justify-between text-sm"><span>Taxa (${feePercent.toFixed(1)}%)</span><span class="font-semibold">${formatCurrency(feeValue)}</span></p>
    <p class="flex justify-between border-t border-slate-200 pt-2 text-base font-bold"><span>Total</span><span>${formatCurrency(total)}</span></p>
  `;
}

function renderCheckoutPaymentMethods() {
  const activeMethods = (state.config.paymentMethods || []).filter(
    (method) => method.active,
  );
  refs.checkoutPaymentMethodsList.innerHTML = activeMethods.length
    ? activeMethods
        .map(
          (method) => `
        <label class="flex h-touch-target-min items-center gap-2 rounded-xl border border-outline-variant px-3 text-sm">
          <input class="payment-method" type="checkbox" value="${method.name}" data-method-id="${method.id}">
          ${method.name}
        </label>
      `,
        )
        .join("")
    : "<p class='col-span-2 rounded-lg border border-outline-variant bg-surface-container-high p-3 text-sm text-on-surface-variant'>Nenhuma forma de pagamento ativa. Ative em Config.</p>";
}

function renderReports() {
  if (!refs.reportsPicker || !refs.reportsDetail || !refs.reportsDetailBody)
    return;

  const today = todayLocalYmd();
  if (!state.reportDateFrom) state.reportDateFrom = today;
  if (!state.reportDateTo) state.reportDateTo = today;
  if (refs.reportsDateFromInput && !refs.reportsDateFromInput.dataset.bound) {
    refs.reportsDateFromInput.dataset.bound = "1";
    refs.reportsDateFromInput.addEventListener("change", () => {
      state.reportDateFrom = refs.reportsDateFromInput.value || today;
      renderReports();
    });
  }
  if (refs.reportsDateToInput && !refs.reportsDateToInput.dataset.bound) {
    refs.reportsDateToInput.dataset.bound = "1";
    refs.reportsDateToInput.addEventListener("change", () => {
      state.reportDateTo = refs.reportsDateToInput.value || today;
      renderReports();
    });
  }
  if (refs.reportsBackButton && !refs.reportsBackButton.dataset.bound) {
    refs.reportsBackButton.dataset.bound = "1";
    refs.reportsBackButton.addEventListener("click", () => {
      state.selectedReport = null;
      renderReports();
    });
  }

  if (refs.reportsDateFromInput)
    refs.reportsDateFromInput.value = state.reportDateFrom;
  if (refs.reportsDateToInput)
    refs.reportsDateToInput.value = state.reportDateTo;

  const fromYmd = state.reportDateFrom || today;
  const toYmd = state.reportDateTo || today;
  const orders = loadOrders();
  const slice = finalizedOrdersInLocalDateRange(orders, fromYmd, toYmd);
  const totalRev = slice.reduce((s, o) => s + (o.totalPaid || 0), 0);
  const orderCount = slice.length;

  if (!state.selectedReport) {
    refs.reportsPicker.classList.remove("hidden");
    refs.reportsDetail.classList.add("hidden");
    return;
  }

  refs.reportsPicker.classList.add("hidden");
  refs.reportsDetail.classList.remove("hidden");

  const titleMap = {
    daily: "Vendas e faturamento",
    payments: "Formas de pagamento",
    products: "Itens mais vendidos",
    peakHour: "Horario de pico",
    weekday: "Dias da semana",
    shiftCloses: "Fechamentos de caixa",
    cashClose: "Fechamento de caixa",
  };
  const title = titleMap[state.selectedReport] || "Relatorio";

  let body = "";
  if (state.selectedReport === "daily" || state.selectedReport === "revenue") {
    body = `
      <p class="text-xs uppercase text-on-surface-variant">${fromYmd === toYmd ? `Data ${fromYmd}` : `${fromYmd} a ${toYmd}`}</p>
      <p class="mt-2 text-[11px] text-on-surface-variant">Comandas <strong>finalizadas</strong> no periodo (pela data do fechamento).</p>
      <div class="mt-stack-md grid grid-cols-2 gap-2">
        <div class="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2">
          <p class="text-[10px] font-semibold uppercase text-on-surface-variant">Comandas</p>
          <p class="text-2xl font-extrabold text-primary">${orderCount}</p>
        </div>
        <div class="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2">
          <p class="text-[10px] font-semibold uppercase text-on-surface-variant">Faturamento</p>
          <p class="text-2xl font-extrabold text-secondary">${formatCurrency(totalRev)}</p>
        </div>
      </div>
    `;
  } else if (state.selectedReport === "payments") {
    const shares = aggregatePaymentMethodShares(slice);
    const rows = paymentSharesSorted(shares);
    body = `
      <p class="text-xs uppercase text-on-surface-variant">${fromYmd === toYmd ? `Data ${fromYmd}` : `${fromYmd} a ${toYmd}`}</p>
      <p class="mt-2 text-[11px] text-on-surface-variant">Valores estimados: quando ha mais de uma forma no mesmo fechamento, o total e dividido igualmente entre elas.</p>
      <ul class="mt-3 space-y-2">
        ${
          rows.length
            ? rows
                .map(
                  (row) => `
          <li class="flex justify-between rounded-lg border border-outline-variant px-3 py-2 text-sm">
            <span>${row.name}</span>
            <span class="font-bold text-primary">${formatCurrency(row.value)}</span>
          </li>`,
                )
                .join("")
            : "<li class='text-sm text-on-surface-variant'>Nenhum pagamento no periodo.</li>"
        }
      </ul>
    `;
  } else if (state.selectedReport === "products") {
    const top = aggregateTopProducts(slice, 20);
    body = `
      <p class="text-xs uppercase text-on-surface-variant">${fromYmd === toYmd ? `Data ${fromYmd}` : `${fromYmd} a ${toYmd}`}</p>
      <ul class="mt-3 space-y-2">
        ${
          top.length
            ? top
                .map(
                  (row) => `
          <li class="flex justify-between gap-2 rounded-lg border border-outline-variant px-3 py-2 text-sm">
            <span class="min-w-0 flex-1">${row.name}</span>
            <span class="shrink-0 font-semibold text-on-surface">${row.qty} un.</span>
            <span class="shrink-0 font-bold text-primary">${formatCurrency(row.revenue)}</span>
          </li>`,
                )
                .join("")
            : "<li class='text-sm text-on-surface-variant'>Nenhum item no periodo.</li>"
        }
      </ul>
    `;
  } else if (state.selectedReport === "peakHour") {
    const { counts, revenue, peakHourIndex } = aggregatePeakHour(slice);
    const maxCount = Math.max(1, ...counts);
    body = `
      <p class="text-xs uppercase text-on-surface-variant">${fromYmd === toYmd ? `Data ${fromYmd}` : `${fromYmd} a ${toYmd}`}</p>
      <p class="mt-2 text-sm text-on-surface-variant">Por hora local do fechamento da comanda.</p>
      ${
        peakHourIndex != null
          ? `<p class="mt-2 text-sm font-semibold text-primary">Pico: ${String(peakHourIndex).padStart(2, "0")}h (${counts[peakHourIndex]} comandas)</p>`
          : "<p class='mt-2 text-sm text-on-surface-variant'>Sem dados.</p>"
      }
      <div class="mt-3 space-y-1">
        ${counts
          .map((c, h) => {
            const w = Math.round((c / maxCount) * 100);
            return `<div class="flex items-center gap-2 text-xs">
              <span class="w-8 tabular-nums text-on-surface-variant">${String(h).padStart(2, "0")}h</span>
              <div class="h-2 flex-1 overflow-hidden rounded-full bg-surface-container-high">
                <div class="h-full rounded-full bg-primary" style="width:${w}%"></div>
              </div>
              <span class="w-16 text-right text-on-surface-variant">${c}</span>
            </div>`;
          })
          .join("")}
      </div>
    `;
  } else if (state.selectedReport === "weekday") {
    const { counts, revenue, peakWeekdayIndex } = aggregateWeekday(slice);
    const maxCount = Math.max(1, ...counts);
    body = `
      <p class="text-xs uppercase text-on-surface-variant">${fromYmd === toYmd ? `Data ${fromYmd}` : `${fromYmd} a ${toYmd}`}</p>
      <p class="mt-2 text-sm text-on-surface-variant">Por dia da semana (fechamento).</p>
      ${
        peakWeekdayIndex != null
          ? `<p class="mt-2 text-sm font-semibold text-primary">Mais comandas: ${WEEKDAY_LABELS_PT[peakWeekdayIndex]} (${counts[peakWeekdayIndex]})</p>`
          : ""
      }
      <div class="mt-3 space-y-1">
        ${counts
          .map((c, wd) => {
            const w = Math.round((c / maxCount) * 100);
            return `<div class="flex items-center gap-2 text-xs">
              <span class="w-10 text-on-surface-variant">${WEEKDAY_LABELS_PT[wd]}</span>
              <div class="h-2 flex-1 overflow-hidden rounded-full bg-surface-container-high">
                <div class="h-full rounded-full bg-secondary" style="width:${w}%"></div>
              </div>
              <span class="w-16 text-right font-semibold text-primary">${formatCurrency(revenue[wd])}</span>
            </div>`;
          })
          .join("")}
      </div>
    `;
  } else if (state.selectedReport === "shiftCloses") {
    const closed = loadClosedShiftsFiltered(fromYmd, toYmd);
    const totalBruto = closed.reduce(
      (s, sh) => s + shiftCloseReportSnapshot(sh).totalBruto,
      0,
    );
    const totalOrders = closed.reduce(
      (s, sh) => s + shiftCloseReportSnapshot(sh).finalizedOrdersCount,
      0,
    );
    body = `
      <p class="text-xs text-on-surface-variant">
        Cada card e um <strong>caixa fechado</strong>. A data de referencia e o dia em que voce abriu (ex.: quinta, mesmo fechando sexta de madrugada).
        Abertura e fechamento mostram o horario real. O filtro <strong>De / Ate</strong> (acima) usa a data de referencia entre ${fromYmd} e ${toYmd}.
      </p>
      <p class="mt-2 text-sm text-on-surface-variant">${closed.length} caixa(s) fechado(s) no filtro</p>
      <p class="text-lg font-extrabold text-secondary">${formatCurrency(totalBruto)}</p>
      <p class="text-xs text-on-surface-variant">${totalOrders} comanda(s) somadas</p>
      <ul class="mt-stack-md space-y-3">
        ${
          closed.length
            ? closed.map((shift) => renderShiftCloseReportCard(shift)).join("")
            : "<li class='rounded-lg border border-outline-variant p-4 text-sm text-on-surface-variant'>Nenhum caixa fechado neste periodo (pela data de referencia).</li>"
        }
      </ul>
    `;
  } else if (state.selectedReport === "cashClose") {
    const uiMsg = state.cashCloseUiMessage;
    state.cashCloseUiMessage = null;
    const shift = getOpenShift();
    const savePending = state.cashClosePendingClose;
    const draft = computeCashCloseDraft(shift);
    if (!shift) {
      body = `
        <p class="text-sm text-on-surface-variant">Nao ha caixa aberto. Para operar, use <strong>Abrir caixa</strong> no Inicio.</p>
        <p class="mt-2 text-xs text-on-surface-variant">Para desfazer um fechamento, use <strong>Configuracoes → Reabrir</strong>.</p>
        <button type="button" id="openCashCloseHistoryButton" class="mt-3 h-touch-target-min w-full rounded-xl border border-outline-variant bg-surface-container-low text-sm font-bold text-on-surface">Ver historico de caixas fechados</button>
        <p id="cashCloseFeedback" class="mt-2 min-h-[1rem] text-xs ${uiMsg?.type === "err" ? "text-error" : uiMsg?.type === "ok" ? "text-secondary" : uiMsg?.type === "warn" ? "text-primary" : "text-on-surface-variant"}">${uiMsg?.text || ""}</p>`;
    } else {
      const refYmd = getCashCloseReferenceDateForUi(shift);
      const refDisplay = refYmd ? refYmd.split("-").reverse().join("/") : "";
      body = `
      <p class="text-xs text-on-surface-variant">Fecha o <strong>caixa atual</strong> (${formatShiftLabel(shift)}). Entram todas as comandas finalizadas desde a abertura.</p>
      <div class="mt-stack-md rounded-xl border border-outline-variant bg-surface-container-low px-3 py-3">
        <label for="cashCloseReferenceDateInput" class="text-xs font-bold text-on-surface">Este caixa e referente a qual dia?</label>
        <input type="date" id="cashCloseReferenceDateInput" value="${refYmd}"
          class="mt-2 h-touch-target-min w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-sm font-semibold text-on-surface" />
        <p class="mt-1.5 text-[10px] text-on-surface-variant">Usado nos relatorios e no historico (ex.: operacao da noite de <strong>${refDisplay || "—"}</strong> fechada depois da meia-noite). Voce pode ajustar antes de confirmar.</p>
      </div>
      ${
        draft.activeOrdersCount > 0
          ? `<div class="mt-stack-md rounded-xl border-2 border-error bg-error-container/40 px-3 py-3" role="alert">
              <p class="text-sm font-extrabold text-error">Venda em aberto</p>
              <p class="mt-1 text-xs text-on-surface">${formatOpenOrdersCashCloseHint()}</p>
            </div>`
          : ""
      }
      <div class="mt-stack-md grid grid-cols-2 gap-2">
        <div class="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 ${draft.activeOrdersCount > 0 ? "ring-2 ring-error" : ""}">
          <p class="text-[10px] font-semibold uppercase text-on-surface-variant">Em aberto</p>
          <p class="text-xl font-extrabold ${draft.activeOrdersCount > 0 ? "text-error" : "text-primary"}">${draft.activeOrdersCount}</p>
        </div>
        <div class="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2">
          <p class="text-[10px] font-semibold uppercase text-on-surface-variant">Total bruto</p>
          <p class="text-xl font-extrabold text-secondary">${formatCurrency(draft.totalBruto)}</p>
        </div>
      </div>
      <p class="mt-2 text-xs text-on-surface-variant">${draft.finalizedOrdersCount} comanda(s) finalizada(s) neste caixa.</p>
      <div class="mt-stack-md grid grid-cols-1 gap-2">
        <button type="button" id="saveCashCloseButton" class="h-touch-target-min w-full rounded-xl text-sm font-bold ${savePending ? "bg-secondary text-on-secondary" : "bg-primary text-on-primary"}">${savePending ? "Confirmar fechamento" : "Fechar caixa"}</button>
      </div>
      <button type="button" id="openCashCloseHistoryButton" class="mt-2 h-touch-target-min w-full rounded-xl border border-outline-variant bg-surface-container-low text-sm font-bold text-on-surface">Ver historico de caixas fechados</button>
      <p id="cashCloseFeedback" class="mt-2 min-h-[1rem] text-xs ${uiMsg?.type === "err" ? "text-error" : uiMsg?.type === "ok" ? "text-secondary" : uiMsg?.type === "warn" ? "text-primary" : "text-on-surface-variant"}">${uiMsg?.text || ""}</p>`;
    }
  } else {
    body =
      "<p class='text-sm text-on-surface-variant'>Selecione um tipo na lista.</p>";
  }

  refs.reportsDetailBody.innerHTML = `
    <h3 class="text-lg font-extrabold text-primary">${title}</h3>
    <div class="mt-stack-md">${body}</div>
  `;
}

function renderAll() {
  applyTheme();
  renderBottomTabs();
  renderSettings();
  renderView();
  renderDashboard();
  renderProductAdmin();
  renderStockAdmin();
  if (state.selectedTab === "reportsTab") {
    renderReports();
  }
  if (state.currentView === "detail" || state.currentView === "checkout") {
    renderCategoryOptions();
    renderOrderDetails();
  }
  if (state.currentView === "checkout") {
    renderCheckoutPaymentMethods();
    renderCheckoutSummary();
  }
}

async function openDetailDialog(orderId, options = {}) {
  const row = loadOrders().find(
    (entry) => String(entry.id) === String(orderId),
  );
  const status = row ? normalizeOrderStatus(row.status) : "Aberta";
  const isViewOnly = status === "Finalizado" || status === "Cancelada";
  if (!isViewOnly && status === "Aberta" && !(await ensureOpenShiftAuto()))
    return;

  if (isPendingLocalOrder()) abandonPendingOrder();
  state.selectedOrderId = orderId;
  state.productSearch = "";
  state.selectedCategory = "Todas";
  state.cancelConfirmOpen = false;
  state.currentView = "detail";
  refs.productSearchInput.value = "";
  const isLocked = status === "Finalizado" || status === "Cancelada";
  if (options.detailAction !== undefined) {
    state.detailAction = options.detailAction;
  } else {
    state.detailAction = !isLocked && status === "Aberta" ? "add" : null;
  }

  renderCategoryOptions();
  renderOrderDetails();
  renderView();
}

async function beginFinalizeFlowForOrderId(orderId) {
  if (!(await ensureOpenShiftAuto())) return;

  if (isPendingLocalOrder()) abandonPendingOrder();
  state.selectedOrderId = orderId;
  const order = loadOrders().find(
    (entry) => String(entry.id) === String(orderId),
  );
  if (!order || !order.items?.length) return;

  const customerName = (order.customer || "").trim();
  if (!customerName) {
    void openDetailDialog(orderId, { detailAction: null });
    refs.detailCustomerFeedback.textContent =
      "Informe o nome do cliente antes de finalizar.";
    return;
  }

  refs.detailCustomerFeedback.textContent = "";
  refs.checkoutFeedback.textContent = "";
  refs.serviceFeeInput.value = String(
    state.config.useServiceFee ? order.serviceFeePercent || 10 : 0,
  );
  renderCheckoutPaymentMethods();
  document.querySelectorAll(".payment-method").forEach((checkbox) => {
    checkbox.checked = order.paymentMethods?.includes(checkbox.value) || false;
  });
  state.currentView = "checkout";
  state.detailAction = null;
  renderCheckoutSummary();
  renderView();
}

/** Linha para fundir ao adicionar o mesmo produto: não reaproveita leva com preparo já entregue (nova leva = nova linha). */
function findMergeTargetLineForProduct(items, productId) {
  const pid = String(productId);
  for (const line of items || []) {
    if (String(line.productId) !== pid) continue;
    if (line.requiresPrep && line.deliveredAt) continue;
    return line;
  }
  return null;
}

async function addItemToOrder(productId) {
  const products = loadProducts();
  const product = products.find(
    (entry) => String(entry.id) === String(productId),
  );
  if (!product) return;

  const requiresPrep =
    product.requiresPrep ?? categoryRequiresPrep(product.category);

  if (isPendingLocalOrder()) {
    await _pendingOrderPostChain;
    let release;
    _pendingOrderPostChain = new Promise((r) => {
      release = r;
    });
    try {
      if (!isPendingLocalOrder()) {
        await addItemToOrder(productId);
        return;
      }
      const order = state.pendingNewOrder;
      const existing = findMergeTargetLineForProduct(order.items, product.id);
      if (existing) {
        existing.qty += 1;
      } else {
        order.items.push({
          lineId: crypto.randomUUID(),
          productId: product.id,
          name: product.name,
          price: product.price,
          qty: 1,
          requiresPrep,
          requestedAt: new Date().toISOString(),
          deliveredAt: null,
          serviceSeconds: null,
          prepStatus: requiresPrep ? "Aguardando" : null,
        });
      }
      order.everHadItems = true;
      order.status = deriveOrderStatus(order);
      applyOrderLineStockDelta(product, -1);
      try {
        await persistPendingOrderToServer();
      } catch (_) {
        renderOrderDetails();
        return;
      }
      renderDashboard();
      renderOrderDetails();
    } finally {
      release();
    }
    return;
  }

  const orders = loadOrders();
  const order = orders.find(
    (entry) => String(entry.id) === String(state.selectedOrderId),
  );
  if (!order) return;

  const existing = findMergeTargetLineForProduct(order.items, product.id);
  if (existing) {
    existing.qty += 1;
  } else {
    order.items.push({
      lineId: crypto.randomUUID(),
      productId: product.id,
      name: product.name,
      price: product.price,
      qty: 1,
      requiresPrep,
      requestedAt: new Date().toISOString(),
      deliveredAt: null,
      serviceSeconds: null,
      prepStatus: requiresPrep ? "Aguardando" : null,
    });
  }
  order.everHadItems = true;
  order.status = deriveOrderStatus(order);
  applyOrderLineStockDelta(product, -1);
  saveOrders(orders);
  renderDashboard();
  renderOrderDetails();
}

function changeItemQty(itemIndex, delta) {
  const order = getCurrentOrder();
  if (!order) return;

  const item = order.items[itemIndex];
  if (!item) return;
  if (delta > 0 && item.requiresPrep && item.deliveredAt) {
    order.items.push({
      lineId: crypto.randomUUID(),
      productId: item.productId,
      name: item.name,
      price: item.price,
      qty: delta,
      requiresPrep: item.requiresPrep === true,
      requestedAt: new Date().toISOString(),
      deliveredAt: null,
      serviceSeconds: null,
      prepStatus: item.requiresPrep ? "Aguardando" : null,
    });
  } else {
    item.qty += delta;
    if (item.qty <= 0) {
      order.items.splice(itemIndex, 1);
    }
  }
  if (delta !== 0 && item.productId) {
    const catalogProduct = findProductById(item.productId);
    if (catalogProduct) applyOrderLineStockDelta(catalogProduct, -delta);
    else applyStockDeltaSilently(item.productId, -delta);
  }
  order.status = deriveOrderStatus(order);

  if (isPendingLocalOrder()) {
    renderDashboard();
    renderOrderDetails();
    return;
  }

  const orders = loadOrders();
  saveOrders(orders);
  renderDashboard();
  renderOrderDetails();
}

function getSelectedProductStockComponentIds() {
  if (!refs.productStockComponentsList) return [];
  return [
    ...refs.productStockComponentsList.querySelectorAll(
      ".product-stock-component-checkbox:checked",
    ),
  ].map((el) => String(el.value));
}

function refreshProductStockDisplayOptions() {
  if (!refs.productStockDisplaySelect) return;
  const selected = getSelectedProductStockComponentIds();
  const current = refs.productStockDisplaySelect.value;
  const products = loadProducts();
  refs.productStockDisplaySelect.innerHTML =
    '<option value="">Selecione um insumo</option>' +
    selected
      .map((id) => {
        const p = products.find((entry) => String(entry.id) === id);
        return `<option value="${id}">${p ? p.name : id}</option>`;
      })
      .join("");
  if (current && selected.includes(current))
    refs.productStockDisplaySelect.value = current;
}

function renderProductSpecialPanel(editingProductId) {
  const editingId =
    editingProductId != null
      ? String(editingProductId)
      : String(refs.productIdInput?.value || "");
  const product = editingId ? findProductById(editingId) : null;
  const selectedIds = new Set(normalizeStockComponentIds(product || {}));

  if (refs.productStockComponentsList) {
    const candidates = loadProducts()
      .filter((entry) => String(entry.id) !== editingId)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    refs.productStockComponentsList.innerHTML = candidates.length
      ? candidates
          .map(
            (entry) => `
        <li>
          <label class="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 hover:bg-surface-container-high/50">
            <input type="checkbox" class="product-stock-component-checkbox h-4 w-4 rounded border-outline-variant text-primary" value="${entry.id}" ${selectedIds.has(String(entry.id)) ? "checked" : ""}>
            <span class="text-sm text-on-surface">${entry.name}</span>
            <span class="ml-auto text-[10px] tabular-nums text-on-surface-variant">${getProductStock(entry.id)} un.</span>
          </label>
        </li>`,
          )
          .join("")
      : "<li class='text-xs text-on-surface-variant'>Cadastre outros produtos para vincular insumos.</li>";
  }

  refreshProductStockDisplayOptions();
  if (
    product?.stockDisplayProductId &&
    selectedIds.has(String(product.stockDisplayProductId))
  ) {
    refs.productStockDisplaySelect.value = String(
      product.stockDisplayProductId,
    );
  }
}

function syncStockControlDependentUi() {
  const stockOn = isStockControlEnabled();
  refs.settingsTabInventoryButton?.classList.toggle("hidden", !stockOn);
  refs.productStockFeaturesWrap?.classList.toggle("hidden", !stockOn);
  if (!stockOn) {
    refs.productSpecialPanel?.classList.add("hidden");
    return;
  }
  syncProductSpecialPanelVisibility();
}

function syncProductSpecialPanelVisibility() {
  if (!isStockControlEnabled()) {
    refs.productSpecialPanel?.classList.add("hidden");
    return;
  }
  const on = !!refs.productSpecialInput?.checked;
  refs.productSpecialPanel?.classList.toggle("hidden", !on);
  if (on) renderProductSpecialPanel();
}

function readProductSpecialFromForm() {
  if (!isStockControlEnabled()) {
    const editingId = String(refs.productIdInput?.value || "").trim();
    if (editingId) {
      const existing = findProductById(editingId);
      if (existing) {
        return {
          isSpecial: !!existing.isSpecial,
          stockComponentIds: normalizeStockComponentIds(existing),
          stockDisplayProductId: existing.stockDisplayProductId || null,
        };
      }
    }
    return {
      isSpecial: false,
      stockComponentIds: [],
      stockDisplayProductId: null,
    };
  }
  const isSpecial = !!refs.productSpecialInput?.checked;
  if (!isSpecial) {
    return {
      isSpecial: false,
      stockComponentIds: [],
      stockDisplayProductId: null,
    };
  }
  const stockComponentIds = getSelectedProductStockComponentIds();
  let stockDisplayProductId = refs.productStockDisplaySelect?.value
    ? String(refs.productStockDisplaySelect.value)
    : null;
  if (
    stockDisplayProductId &&
    !stockComponentIds.includes(stockDisplayProductId)
  ) {
    stockDisplayProductId = stockComponentIds[0] || null;
  }
  return { isSpecial: true, stockComponentIds, stockDisplayProductId };
}

function fillProductForm(productId) {
  const product = loadProducts().find(
    (entry) => String(entry.id) === String(productId),
  );
  if (!product) return;
  state.selectedTab = "settingsTab";
  state.selectedSettingsTab = "products";
  renderAll();
  refs.productIdInput.value = product.id;
  refs.productNameInput.value = product.name;
  const hasCategoryOption = [...refs.productCategoryInput.options].some(
    (option) => option.value === product.category,
  );
  if (!hasCategoryOption) {
    const option = document.createElement("option");
    option.value = product.category;
    option.textContent = `${product.category} (legada)`;
    refs.productCategoryInput.appendChild(option);
  }
  refs.productCategoryInput.value = product.category;
  refs.productPriceInput.value = product.price;
  refs.productRequiresPrepInput.checked =
    product.requiresPrep ?? categoryRequiresPrep(product.category);
  if (refs.productSpecialInput)
    refs.productSpecialInput.checked = !!product.isSpecial;
  renderProductSpecialPanel(product.id);
  syncStockControlDependentUi();
  refs.productSubmitButton.textContent = "Atualizar";
  refs.productNameInput.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearProductForm() {
  refs.productForm.reset();
  refs.productIdInput.value = "";
  if (refs.productSpecialInput) refs.productSpecialInput.checked = false;
  syncProductSpecialPanelVisibility();
  refs.productSubmitButton.textContent = "Salvar";
}

function deleteCategory(categoryName) {
  const hasProductsUsingCategory = loadProducts().some(
    (product) => product.category === categoryName,
  );
  if (hasProductsUsingCategory) {
    refs.categoryFeedback.textContent =
      "Nao e possivel excluir: existem produtos nessa categoria.";
    return;
  }
  state.config.categories = state.config.categories.filter(
    (category) => category !== categoryName,
  );
  state.config.prepCategories = (state.config.prepCategories || []).filter(
    (category) => category !== categoryName,
  );
  saveConfig(state.config);
  refs.categoryFeedback.textContent = "";
  renderAll();
}

function deletePaymentMethod(methodId) {
  const methods = state.config.paymentMethods || [];
  if (methods.length <= 1) {
    refs.paymentMethodFeedback.textContent =
      "Mantenha ao menos uma forma de pagamento.";
    return;
  }
  state.config.paymentMethods = methods.filter(
    (method) => method.id !== methodId,
  );
  saveConfig(state.config);
  refs.paymentMethodFeedback.textContent = "";
  renderAll();
}

function deleteProduct(productId) {
  const products = loadProducts().filter(
    (product) => String(product.id) !== String(productId),
  );
  void deleteProductRemote(productId).catch((e) =>
    console.error("[JANA] deleteProduct", e),
  );
  saveProducts(products);
  renderAll();
}

/** Press feedback em todos os <button> (mesmo padrao do Adicionar na comanda). */
function bindGlobalButtonPressFeedbackOnce() {
  if (document.documentElement.dataset.globalButtonPress === "1") return;
  document.documentElement.dataset.globalButtonPress = "1";

  const release = () => {
    if (globalButtonPressTarget) {
      globalButtonPressTarget.classList.remove("is-pressed");
      globalButtonPressTarget = null;
    }
  };

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      const btn = e.target.closest("button");
      if (!btn || btn.disabled) return;
      if (globalButtonPressTarget && globalButtonPressTarget !== btn) {
        globalButtonPressTarget.classList.remove("is-pressed");
      }
      globalButtonPressTarget = btn;
      btn.classList.add("is-pressed");
    },
    true,
  );

  document.addEventListener("pointerup", release, true);
  document.addEventListener("pointercancel", release, true);
}

function bindDetailCustomerViewportAssistOnce() {
  // Intencionalmente sem ajuste: deixa o navegador/sistema lidar com teclado virtual.
}

/** Toque no catalogo da comanda: pointerup (nao depende do click sintetico do iOS). */
function bindOrderDetailInteractionsOnce() {
  const list = refs.availableProductsList;
  if (!list || list.dataset.orderDetailBound === "1") return;
  list.dataset.orderDetailBound = "1";

  const TAP_MOVE_PX = 24;
  let pickerTap = null;

  list.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      const btn = e.target.closest(".add-product-button");
      if (!btn || btn.disabled) return;
      pickerTap = {
        pointerId: e.pointerId,
        productId: String(btn.dataset.productId || ""),
        x: e.clientX,
        y: e.clientY,
      };
    },
    true,
  );

  const clearPickerTap = (e) => {
    if (!pickerTap || e.pointerId !== pickerTap.pointerId) return;
    pickerTap = null;
  };
  list.addEventListener("pointercancel", clearPickerTap, true);

  list.addEventListener(
    "pointerup",
    (e) => {
      if (e.button !== 0 || !pickerTap || e.pointerId !== pickerTap.pointerId)
        return;
      const btn = e.target.closest(".add-product-button");
      const { productId, x, y } = pickerTap;
      pickerTap = null;
      if (!btn || String(btn.dataset.productId || "") !== productId) return;
      const dx = e.clientX - x;
      const dy = e.clientY - y;
      if (dx * dx + dy * dy > TAP_MOVE_PX * TAP_MOVE_PX) return;
      void addItemToOrder(productId);
    },
    true,
  );

  const itemsList = refs.orderItemsList;
  if (itemsList && itemsList.dataset.orderItemsDelegate !== "1") {
    itemsList.dataset.orderItemsDelegate = "1";
    itemsList.addEventListener("click", (e) => {
      const plus = e.target.closest(".qty-plus");
      if (plus) {
        changeItemQty(Number(plus.dataset.index), 1);
        return;
      }
      const minus = e.target.closest(".qty-minus");
      if (minus) {
        changeItemQty(Number(minus.dataset.index), -1);
        return;
      }
      const delivered = e.target.closest(".mark-delivered-button");
      if (delivered) markLineDelivered(delivered.dataset.lineId);
    });
  }
}

function bindEvents() {
  bindDetailCustomerViewportAssistOnce();
  refs.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    refs.loginFeedback.textContent = "";
    const email = refs.usernameInput.value.trim();
    const password = refs.passwordInput.value.trim();

    if (!isSupabaseConfigured()) {
      refs.loginFeedback.textContent =
        "Configure supabase-config.js com a URL do projeto e a chave anon (Settings → API).";
      return;
    }
    if (!email) {
      refs.loginFeedback.textContent = "Informe o email.";
      return;
    }
    if (!password) {
      refs.loginFeedback.textContent = "Informe a senha.";
      return;
    }
    try {
      localStorage.setItem("jana_last_email", email);
      const sb = await getSupabase();
      if (!sb) {
        refs.loginFeedback.textContent = "Supabase nao inicializado.";
        return;
      }
      const { data: signData, error } = await sb.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        refs.loginFeedback.textContent =
          error.message || "Credenciais invalidas.";
        return;
      }
      refs.loginForm.reset();
      if (signData.session) {
        await applySupabaseSession(signData.session);
      } else {
        refs.loginFeedback.textContent =
          "Login ok mas sessao vazia. Atualize a pagina.";
        console.warn("[JANA] signInWithPassword sem session no retorno");
      }
    } catch (e) {
      console.error(e);
      refs.loginFeedback.textContent = "Falha no login.";
    }
  });

  refs.biometricButton.addEventListener("click", () => {
    refs.loginFeedback.textContent = "";
    const last = localStorage.getItem("jana_last_email");
    if (last) {
      refs.usernameInput.value = last;
      refs.usernameInput.focus();
      return;
    }
    refs.loginFeedback.textContent = "Nenhum email salvo. Faca login uma vez.";
  });

  refs.logoutButton.addEventListener("click", async () => {
    state.currentView = "main";
    refs.orderDialog.close();
    try {
      const sb = await getSupabase();
      if (sb) await sb.auth.signOut();
    } catch (e) {
      console.error(e);
      clearLoggedUser();
      clearDataCache();
      renderAuth();
    }
  });

  refs.openSettingsButton.addEventListener("click", () => {
    state.currentView = "main";
    state.selectedTab = "settingsTab";
    state.selectedSettingsTab = "products";
    renderAll();
  });

  refs.statusFilters.forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedFilter = button.dataset.filter;
      refs.statusFilters.forEach((filterButton) => {
        const selected = filterButton.dataset.filter === state.selectedFilter;
        filterButton.className = selected
          ? "status-filter h-touch-target-min flex-1 rounded-full bg-primary-container px-3 text-xs font-bold text-on-primary-container"
          : "status-filter h-touch-target-min flex-1 rounded-full bg-surface-container-high px-3 text-xs font-bold text-on-surface-variant";
      });
      renderDashboard();
    });
  });
  refs.openShiftButton?.addEventListener("click", () => {
    void (async () => {
      try {
        await openShiftManual();
        state.cashCloseUiMessage = { type: "ok", text: "Caixa aberto." };
        renderAll();
      } catch (e) {
        console.error(e);
        state.cashCloseUiMessage = {
          type: "err",
          text: (e && e.message) || "Nao foi possivel abrir o caixa.",
        };
        renderDashboard();
      }
    })();
  });

  refs.newOrderButton.addEventListener("click", () => {
    void createNewOrderAndOpen();
  });
  refs.closeOrderDialogButton.addEventListener("click", () =>
    refs.orderDialog.close(),
  );

  refs.bottomTabs.forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTab = button.dataset.tab || "dashboardTab";
      if (state.selectedTab === "dashboardTab") {
        state.currentView = "main";
        state.detailAction = null;
        state.cancelConfirmOpen = false;
        if (isPendingLocalOrder()) abandonPendingOrder();
      }
      if (state.selectedTab === "settingsTab") {
        state.selectedSettingsTab = "products";
      }
      if (state.selectedTab === "reportsTab") {
        state.currentView = "main";
      }
      renderAll();
    });
  });

  document.querySelectorAll(".report-type-button").forEach((btn) => {
    if (btn.dataset.boundReport) return;
    btn.dataset.boundReport = "1";
    btn.addEventListener("click", () => {
      state.selectedReport = btn.dataset.report || null;
      renderReports();
    });
  });

  if (refs.reportsDetail && !refs.reportsDetail.dataset.cashCloseDelegate) {
    refs.reportsDetail.dataset.cashCloseDelegate = "1";
    refs.reportsDetail.addEventListener("change", (e) => {
      if (e.target.id === "cashCloseReferenceDateInput") {
        state.cashCloseReferenceDateYmd = e.target.value || "";
      }
    });
    refs.reportsDetail.addEventListener("click", (e) => {
      const button = e.target.closest("button");
      if (!button) return;
      if (button.id === "openCashCloseHistoryButton") {
        e.preventDefault();
        openCashCloseHistoryDialog();
        return;
      }
      if (button.id !== "saveCashCloseButton") return;
      e.preventDefault();
      const shift = getOpenShift();
      void (async () => {
        try {
          if (!shift) {
            state.cashCloseUiMessage = {
              type: "err",
              text: "Nenhum caixa aberto.",
            };
            renderReports();
            return;
          }
          const refInput = document.querySelector(
            "#cashCloseReferenceDateInput",
          );
          if (refInput?.value)
            state.cashCloseReferenceDateYmd = refInput.value.trim();
          const refYmd =
            state.cashCloseReferenceDateYmd ||
            suggestReferenceDateForShift(shift);
          if (!isValidYmd(refYmd)) {
            state.cashCloseUiMessage = {
              type: "err",
              text: "Informe o dia de referencia do caixa (campo acima).",
            };
            renderReports();
            return;
          }
          if (!state.cashClosePendingClose) {
            state.cashClosePendingClose = true;
            const refLabel = refYmd.split("-").reverse().join("/");
            const openHint = formatOpenOrdersCashCloseHint();
            const openWarn = openHint
              ? `${openHint} Se quiser fechar mesmo assim, `
              : "";
            state.cashCloseUiMessage = {
              type: "warn",
              text: `${openWarn}confirme o fechamento do caixa referente a ${refLabel}. Clique novamente em "Confirmar fechamento".`,
            };
            renderReports();
            return;
          }
          await persistShiftClose(shift, refYmd);
          state.cashClosePendingClose = false;
          state.cashCloseUiMessage = {
            type: "ok",
            text: "Caixa fechado com sucesso.",
          };
          renderDashboard();
          renderReports();
          if (!refs.cashCloseHistoryDialog?.classList.contains("hidden")) {
            renderCashCloseHistoryOverlay();
          }
        } catch (err) {
          console.error(err);
          state.cashClosePendingClose = false;
          state.cashCloseUiMessage = {
            type: "err",
            text: err?.message || "Nao foi possivel fechar o caixa.",
          };
          renderReports();
        }
      })();
    });
  }

  refs.orderForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      await createNewOrderAndOpen();
      refs.orderForm.reset();
      refs.orderDialog.close();
    })();
  });

  refs.settingsTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedSettingsTab = button.dataset.settingsTab;
      renderSettings();
      refreshSettingsCategoryFilterHints();
    });
  });

  refs.settingsTabsScroll?.addEventListener("scroll", updateSettingsTabsHints);
  refs.categoryButtons?.addEventListener("scroll", updateCategoryTabsHints);
  refs.productAdminCategoryButtons?.addEventListener(
    "scroll",
    updateProductAdminCategoryTabsHints,
  );
  refs.stockAdminCategoryButtons?.addEventListener(
    "scroll",
    updateStockAdminCategoryTabsHints,
  );
  window.addEventListener("resize", updateSettingsTabsHints);
  window.addEventListener("resize", updateCategoryTabsHints);
  window.addEventListener("resize", updateProductAdminCategoryTabsHints);
  window.addEventListener("resize", updateStockAdminCategoryTabsHints);

  refs.closeDetailDialogButton.addEventListener("click", () => {
    state.currentView = "main";
    state.detailAction = null;
    state.cancelConfirmOpen = false;
    if (isPendingLocalOrder()) abandonPendingOrder();
    renderView();
  });

  refs.confirmDetailButton.addEventListener("click", () => {
    const customerName = refs.detailCustomerInput.value.trim();
    if (!customerName) {
      refs.detailCustomerFeedback.textContent =
        "Informe o nome do cliente para confirmar.";
      refs.detailCustomerInput.focus();
      return;
    }
    refs.detailCustomerFeedback.textContent = "";
    const order = getCurrentOrder();
    if (isPendingLocalOrder()) {
      state.pendingNewOrder.customer = customerName;
      if (state.config.useTables && refs.orderTableInput) {
        state.pendingNewOrder.table = refs.orderTableInput.value.trim();
      }
      abandonPendingOrder();
      state.currentView = "main";
      state.detailAction = null;
      state.cancelConfirmOpen = false;
      renderAll();
      return;
    }
    if (order) {
      const orders = loadOrders();
      const target = orders.find(
        (entry) => String(entry.id) === String(order.id),
      );
      if (target) {
        target.customer = customerName;
        if (state.config.useTables && refs.orderTableInput) {
          target.table = refs.orderTableInput.value.trim();
        }
        saveOrders(orders);
      }
    }
    state.currentView = "main";
    state.detailAction = null;
    state.cancelConfirmOpen = false;
    renderAll();
  });

  refs.saveCustomerButton.addEventListener("click", () => {
    const order = getCurrentOrder();
    if (!order) return;
    const customerName = refs.detailCustomerInput.value.trim();
    if (!customerName) {
      refs.detailCustomerFeedback.textContent =
        "Nome do cliente é obrigatório.";
      refs.detailCustomerInput.focus();
      return;
    }
    if (isPendingLocalOrder()) {
      state.pendingNewOrder.customer = customerName;
      if (state.config.useTables && refs.orderTableInput) {
        state.pendingNewOrder.table = refs.orderTableInput.value.trim();
      }
      refs.detailCustomerFeedback.textContent = "";
      renderOrderDetails();
      return;
    }
    const orders = loadOrders();
    const target = orders.find(
      (entry) => String(entry.id) === String(order.id),
    );
    if (!target) return;
    target.customer = customerName;
    if (state.config.useTables && refs.orderTableInput) {
      target.table = refs.orderTableInput.value.trim();
    }
    saveOrders(orders);
    refs.detailCustomerFeedback.textContent = "";
    renderOrderDetails();
    renderDashboard();
  });

  refs.openCancelFlowButton.addEventListener("click", () => {
    state.cancelConfirmOpen = true;
    renderOrderDetails();
  });

  refs.dismissCancelOrderButton.addEventListener("click", () => {
    state.cancelConfirmOpen = false;
    renderOrderDetails();
  });

  refs.confirmCancelOrderButton.addEventListener("click", async () => {
    if (isPendingLocalOrder()) {
      abandonPendingOrder();
      state.cancelConfirmOpen = false;
      state.currentView = "main";
      state.detailAction = null;
      renderAll();
      return;
    }

    const orders = loadOrders();
    const targetIndex = orders.findIndex(
      (entry) => String(entry.id) === String(state.selectedOrderId),
    );
    if (targetIndex < 0) return;
    const target = orders[targetIndex];
    if (target.id === undefined || target.id === null || target.id === "")
      return;

    const temItensNaComanda =
      Array.isArray(target.items) && target.items.length > 0;

    if (!temItensNaComanda) {
      try {
        await deleteCommandaRemote(target.id);
      } catch (_) {
        /* servidor indisponivel */
      }
      orders.splice(targetIndex, 1);
      state.cache.commandas = orders;
    } else {
      restoreOrderItemsToStock(target.items);
      target.status = "Cancelada";
      target.canceledAt = new Date().toISOString();
      saveOrders(orders);
    }

    state.cancelConfirmOpen = false;
    state.currentView = "main";
    state.selectedOrderId = null;
    renderAll();
  });

  refs.productSearchInput.addEventListener("input", () => {
    state.productSearch = refs.productSearchInput.value;
    renderOrderDetails();
  });

  refs.closeCheckoutDialogButton.addEventListener("click", () => {
    state.currentView = "main";
    state.detailAction = null;
    state.selectedOrderId = null;
    refs.checkoutFeedback.textContent = "";
    renderAll();
  });
  refs.closeCashCloseHistoryButton?.addEventListener(
    "click",
    closeCashCloseHistoryDialog,
  );
  refs.cashCloseHistoryBody?.addEventListener("click", (e) => {
    const button = e.target.closest(".cash-close-history-toggle");
    if (!button) return;
    const id = String(button.dataset.closeId || "");
    if (!id) return;
    state.cashCloseHistoryExpandedId =
      state.cashCloseHistoryExpandedId === id ? null : id;
    renderCashCloseHistoryOverlay();
  });
  refs.serviceFeeInput.addEventListener("input", renderCheckoutSummary);

  refs.confirmCheckoutButton.addEventListener("click", () => {
    const order = getCurrentOrder();
    if (!order) return;
    const paymentMethods = [
      ...document.querySelectorAll(".payment-method:checked"),
    ].map((checkbox) => checkbox.value);
    if (!paymentMethods.length) {
      refs.checkoutFeedback.textContent =
        "Selecione ao menos uma forma de pagamento.";
      return;
    }
    const subtotal = calculateOrderSubtotal(order);
    const serviceFeePercent = state.config.useServiceFee
      ? Number(refs.serviceFeeInput.value) || 0
      : 0;
    const serviceFee = subtotal * (serviceFeePercent / 100);
    const totalPaid = subtotal + serviceFee;

    const orders = loadOrders();
    const target = orders.find(
      (entry) => String(entry.id) === String(order.id),
    );
    if (!target) return;
    const openShift = getOpenShift();
    if (!openShift) {
      refs.checkoutFeedback.textContent =
        "Abra o caixa no Inicio antes de finalizar a comanda.";
      return;
    }
    target.status = "Finalizado";
    target.paymentMethods = paymentMethods;
    target.serviceFeePercent = serviceFeePercent;
    target.totalPaid = totalPaid;
    target.closedAt = new Date().toISOString();
    target.shiftId = openShift.id;
    saveOrders(orders);

    state.currentView = "main";
    state.selectedOrderId = null;
    renderAll();
  });

  refs.productForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const products = loadProducts();
    const special = readProductSpecialFromForm();
    const productData = {
      name: refs.productNameInput.value.trim(),
      category: refs.productCategoryInput.value.trim(),
      price: Number(refs.productPriceInput.value),
      requiresPrep: refs.productRequiresPrepInput.checked,
      isSpecial: special.isSpecial,
      stockComponentIds: special.stockComponentIds,
      stockDisplayProductId: special.stockDisplayProductId,
    };
    if (
      !productData.name ||
      !productData.category ||
      Number.isNaN(productData.price)
    )
      return;
    if (
      isStockControlEnabled() &&
      productData.isSpecial &&
      !productData.stockComponentIds.length
    ) {
      alert("Item especial: marque ao menos um insumo para debitar o estoque.");
      return;
    }
    if (refs.productIdInput.value) {
      const target = products.find(
        (product) => String(product.id) === String(refs.productIdInput.value),
      );
      if (target) {
        target.name = productData.name;
        target.category = productData.category;
        target.price = productData.price;
        target.requiresPrep = productData.requiresPrep;
        target.isSpecial = productData.isSpecial;
        target.stockComponentIds = productData.stockComponentIds;
        target.stockDisplayProductId = productData.stockDisplayProductId;
      }
    } else {
      const newProduct = { ...productData, id: crypto.randomUUID(), stock: 0 };
      products.unshift(newProduct);
      void (async () => {
        try {
          await upsertProductRemote(newProduct);
          await ensureProductStockRowRemote(newProduct.id);
          saveProducts(products);
          renderAll();
        } catch (e) {
          console.error("[JANA] novo produto", e);
        }
      })();
      renderAll();
      return;
    }

    saveProducts(products);
    clearProductForm();
    renderAll();
  });

  refs.clearProductFormButton.addEventListener("click", clearProductForm);

  refs.productSpecialInput?.addEventListener(
    "change",
    syncProductSpecialPanelVisibility,
  );
  refs.productStockComponentsList?.addEventListener("change", (e) => {
    if (e.target.classList?.contains("product-stock-component-checkbox"))
      refreshProductStockDisplayOptions();
  });

  refs.productAdminCategoryButtons?.addEventListener("click", (e) => {
    const button = e.target.closest(".product-admin-category-filter");
    if (!button) return;
    state.productAdminCategoryFilter = button.dataset.category || "Todas";
    renderProductAdmin();
  });

  refs.stockAdminCategoryButtons?.addEventListener("click", (e) => {
    const button = e.target.closest(".stock-admin-category-filter");
    if (!button) return;
    state.stockAdminCategoryFilter = button.dataset.category || "Todas";
    renderStockAdmin();
  });

  refs.tableModeToggle.addEventListener("change", () => {
    state.config.useTables = refs.tableModeToggle.checked;
    saveConfig(state.config);
    renderAll();
  });

  refs.serviceFeeToggle.addEventListener("change", () => {
    state.config.useServiceFee = refs.serviceFeeToggle.checked;
    saveConfig(state.config);
    renderAll();
  });

  refs.stockModeToggle?.addEventListener("change", () => {
    state.config.useStock = refs.stockModeToggle.checked;
    saveConfig(state.config);
    renderAll();
  });

  refs.categoryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    refs.categoryFeedback.textContent = "";
    const name = refs.categoryNameInput.value.trim();
    if (!name) return;

    const exists = state.config.categories.some(
      (category) => category.toLowerCase() === name.toLowerCase(),
    );
    if (exists) {
      refs.categoryFeedback.textContent = "Categoria ja cadastrada.";
      return;
    }

    state.config.categories.push(name);
    saveConfig(state.config);
    refs.categoryForm.reset();
    renderAll();
  });

  refs.paymentMethodForm.addEventListener("submit", (event) => {
    event.preventDefault();
    refs.paymentMethodFeedback.textContent = "";
    const name = refs.paymentMethodNameInput.value.trim();
    if (!name) return;

    const exists = (state.config.paymentMethods || []).some(
      (method) => method.name.toLowerCase() === name.toLowerCase(),
    );
    if (exists) {
      refs.paymentMethodFeedback.textContent =
        "Forma de pagamento ja cadastrada.";
      return;
    }

    state.config.paymentMethods.push({
      id: crypto.randomUUID(),
      name,
      active: true,
    });
    saveConfig(state.config);
    refs.paymentMethodForm.reset();
    renderAll();
  });

  refs.confirmSettingsButton.addEventListener("click", () => {
    state.selectedTab = "dashboardTab";
    renderAll();
  });

  refs.reopenSearchButton?.addEventListener("click", () => renderReopenPanel());
  refs.reopenFilterDateInput?.addEventListener("change", () =>
    renderReopenPanel(),
  );
  refs.reopenShiftUndoButton?.addEventListener("click", () => {
    void (async () => {
      try {
        if (!canUndoLastShiftClose()) {
          setReopenShiftFeedback("err", undoLastShiftCloseHint());
          renderReopenShiftPanel();
          return;
        }
        if (!state.reopenShiftPendingConfirm) {
          state.reopenShiftPendingConfirm = true;
          setReopenShiftFeedback(
            "warn",
            "Confirmar? O ultimo caixa fechado volta a ficar aberto (o mesmo turno).",
          );
          renderReopenShiftPanel();
          return;
        }
        const ok = await rollbackLastClosedShift();
        state.reopenShiftPendingConfirm = false;
        setReopenShiftFeedback(
          ok ? "ok" : "err",
          ok
            ? "Caixa reaberto. Confira no Inicio."
            : "Nao foi possivel desfazer o fechamento.",
        );
        renderDashboard();
        renderReports();
        renderReopenShiftPanel();
      } catch (err) {
        console.error(err);
        state.reopenShiftPendingConfirm = false;
        setReopenShiftFeedback(
          "err",
          err?.message || "Nao foi possivel reabrir o caixa.",
        );
        renderReopenShiftPanel();
      }
    })();
  });

  refs.reopenConfirmDismissButton?.addEventListener("click", () => {
    refs.reopenConfirmDialog?.close();
  });
  refs.reopenConfirmAcceptButton?.addEventListener("click", () => {
    const id = refs.reopenConfirmAcceptButton?.dataset.orderId;
    if (!id) return;
    if (performReopenOrder(id)) {
      refs.reopenConfirmDialog?.close();
      renderReopenPanel();
      renderAll();
    }
  });

  bindOrderDetailInteractionsOnce();
  bindGlobalButtonPressFeedbackOnce();
  bindStockAdminInteractionsOnce();
}

/** iOS Safari ainda dispara double-tap zoom mesmo com viewport maximum-scale=1. Bloqueia. */
function bindIosDoubleTapBlocker() {
  let lastTouchEnd = 0;
  const interactiveSelector =
    "button, a, input, select, textarea, label, [role='button'], [contenteditable='true']";
  document.addEventListener(
    "touchend",
    (e) => {
      if (e.target.closest(interactiveSelector)) return;
      const now = Date.now();
      if (now - lastTouchEnd < 350) e.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false },
  );
  document.addEventListener("gesturestart", (e) => e.preventDefault());
}

/**
 * Pull-to-refresh: Safari (e outros) so recarregam a pagina ao overscroll do documento.
 * Com body overflow:hidden e scroll so em #mainContent, o gesto nativo some — simulamos aqui.
 */
function bindPullToRefresh(scroller) {
  const el = scroller;
  if (!el || el.dataset.pullRefreshBound === "1") return;
  el.dataset.pullRefreshBound = "1";
  let startY = 0;
  let tracking = false;
  let maxPull = 0;
  el.addEventListener(
    "touchstart",
    (e) => {
      if (el.scrollTop > 2) {
        tracking = false;
        return;
      }
      tracking = true;
      startY = e.touches[0].clientY;
      maxPull = 0;
    },
    { passive: true },
  );
  el.addEventListener(
    "touchmove",
    (e) => {
      if (!tracking) return;
      if (el.scrollTop > 2) {
        tracking = false;
        return;
      }
      const y = e.touches[0].clientY;
      const delta = y - startY;
      if (delta > 0) maxPull = Math.max(maxPull, delta);
    },
    { passive: true },
  );
  el.addEventListener(
    "touchend",
    () => {
      if (tracking && maxPull >= 72) window.location.reload();
      tracking = false;
      maxPull = 0;
    },
    { passive: true },
  );
}

async function init() {
  const t = todayLocalYmd();
  state.reportDateFrom = t;
  state.reportDateTo = t;
  bindEvents();
  bindIosDoubleTapBlocker();
  bindPullToRefresh(refs.mainContent);
  bindPullToRefresh(refs.loginScreen);

  if (!isSupabaseConfigured()) {
    refs.loginFeedback.textContent =
      "Configure supabase-config.js com a URL do projeto e a chave anon (Settings → API).";
    applyTheme();
    renderAuth();
    return;
  }

  try {
    const supabase = await getSupabase();
    if (!supabase) throw new Error("client");

    const {
      data: { session: existingSession },
    } = await supabase.auth.getSession();
    if (existingSession) {
      await applySupabaseSession(existingSession);
    } else {
      renderAuth();
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "INITIAL_SESSION") {
        if (!session) {
          renderAuth();
          return;
        }
        await applySupabaseSession(session);
        return;
      }
      if (event === "SIGNED_OUT") {
        clearDataCache();
        clearLoggedUser();
        renderAuth();
      }
    });
  } catch (e) {
    console.error(e);
    refs.loginFeedback.textContent =
      "Nao foi possivel iniciar o Supabase. Verifique supabase-config.js (URL e chave anon).";
    applyTheme();
    renderAuth();
  }
}

if (typeof globalThis.__JANA_REGISTER_TEST_EXPORTS__ === "function") {
  globalThis.__JANA_REGISTER_TEST_EXPORTS__({
    normalizeSupabaseProjectUrl,
    isSupabaseConfigured,
    getSupabase,
    defaultConfigPayload,
    isStockControlEnabled,
    formatProductStockHintForCatalog,
    productRowToApp,
    productToRow,
    normalizeStockComponentIds,
    findProductById,
    getProductStockDisplayQuantity,
    applyOrderLineStockDelta,
    getProductStock,
    setProductStockLocal,
    applyStockDeltaSilently,
    restoreOrderItemsToStock,
    abandonPendingOrder,
    commandaToPayload,
    commandaPayloadDocument,
    toIsoTimestamptz,
    todayLocalYmdFromDate,
    localDateFromYmd,
    formatYmdWithWeekday,
    formatDateTimeShort,
    dailyCloseRowToShiftLike,
    isDuplicateOfShift,
    loadAllClosedSessions,
    loadClosedShiftsFiltered,
    shiftCloseReportSnapshot,
    renderShiftCloseReportCard,
    localHmFromDate,
    shiftRowToApp,
    loadShifts,
    getOpenShift,
    isLegacyAutoOpenShift,
    shiftHasRegisterActivity,
    shouldInferOpenShiftFromOpenOrders,
    reconcileShiftsAfterBootstrap,
    formatShiftLabel,
    orderBelongsToShift,
    ordersFinalizedInShift,
    ordersForDashboard,
    computeCashCloseDraft,
    isValidYmd,
    suggestReferenceDateForShift,
    getCashCloseReferenceDateForUi,
    ensureProfile,
    bootstrapFromSupabase,
    applySupabaseSession,
    upsertProductRemote,
    deleteProductRemote,
    adjustProductStockRemote,
    setProductStockRemote,
    ensureProductStockRowRemote,
    upsertCommandaRemote,
    deleteCommandaRemote,
    upsertAppConfigRemote,
    insertDailyCloseRemote,
    deleteDailyCloseRemote,
    insertShiftRemote,
    closeShiftRemote,
    reopenShiftRemote,
    openShiftManual,
    ensureOpenShiftAuto,
    persistShiftClose,
    getLastClosedShift,
    canUndoLastShiftClose,
    undoLastShiftCloseHint,
    rollbackLastClosedShift,
    clearDataCache,
    hideAuthBootScreen,
    showAuthBootScreen,
    formatCurrency,
    formatProductStockHint,
    loadProducts,
    saveProducts,
    loadOrders,
    saveOrders,
    loadClosedShiftsForHistory,
    renderCashCloseHistoryOverlay,
    openCashCloseHistoryDialog,
    closeCashCloseHistoryDialog,
    loadConfig,
    saveConfig,
    applyTheme,
    updateHorizontalScrollHints,
    scheduleHorizontalScrollHints,
    updateSettingsTabsHints,
    updateCategoryTabsHints,
    updateProductAdminCategoryTabsHints,
    updateStockAdminCategoryTabsHints,
    refreshSettingsCategoryFilterHints,
    isPendingLocalOrder,
    getCurrentOrder,
    calculateOrderSubtotal,
    calculatePaidInDateRange,
    finalizedOrdersInLocalDateRange,
    aggregatePaymentMethodShares,
    aggregateTopProducts,
    aggregatePeakHour,
    aggregateWeekday,
    paymentSharesSorted,
    categoryRequiresPrep,
    normalizeOrderStatus,
    getOpenOrders,
    formatOpenOrdersCashCloseHint,
    deriveOrderStatus,
    formatTimeShort,
    formatElapsedSince,
    formatElapsedClock,
    formatDurationFromSeconds,
    ensureLineIds,
    computeServiceSeconds,
    syncOrderLineTimerElements,
    syncOrderItemsTimerInterval,
    markLineDelivered,
    formatOrderIdentification,
    formatOrderSubline,
    todayLocalYmd,
    localYmdFromIso,
    orderReopenEventYmd,
    recordOrderReopenAudit,
    performReopenOrder,
    openReopenConfirmDialog,
    setReopenShiftFeedback,
    renderReopenShiftPanel,
    renderReopenPanel,
    persistPendingOrderToServer,
    persistOrderTableFromDetail,
    createNewOrderAndOpen,
    setLoggedUser,
    clearLoggedUser,
    renderAuth,
    renderShiftBar,
    renderDashboard,
    renderHeaderSettingsButton,
    renderBottomTabs,
    renderView,
    renderProductCategoryOptions,
    renderSettings,
    productCategoryFilterOptions,
    renderProductAdminCategoryFilters,
    renderProductAdmin,
    renderStockAdminCategoryFilters,
    renderStockAdmin,
    saveStockForProductId,
    applyStockIncrementFromRow,
    bindStockAdminInteractionsOnce,
    renderCategoryOptions,
    renderOrderDetails,
    renderCheckoutSummary,
    renderCheckoutPaymentMethods,
    renderReports,
    renderAll,
    openDetailDialog,
    beginFinalizeFlowForOrderId,
    findMergeTargetLineForProduct,
    addItemToOrder,
    changeItemQty,
    fillProductForm,
    clearProductForm,
    renderProductSpecialPanel,
    syncStockControlDependentUi,
    syncProductSpecialPanelVisibility,
    readProductSpecialFromForm,
    deleteCategory,
    deletePaymentMethod,
    deleteProduct,
    bindGlobalButtonPressFeedbackOnce,
    bindDetailCustomerViewportAssistOnce,
    bindEvents,
    bindIosDoubleTapBlocker,
    bindPullToRefresh,
    injectSupabaseClientForTests,
    resetSupabaseClientForTests,
    state,
    refs,
    PENDING_ORDER_ID,
    THEME_PRESETS,
  });
}

if (typeof globalThis.__JANA_SKIP_INIT__ === "undefined") {
  init();
}
