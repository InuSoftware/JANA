/** Polyfill: crypto.randomUUID so existe em secure contexts (HTTPS/localhost). */
(function () {
  if (typeof globalThis.crypto !== "object") globalThis.crypto = {};
  if (typeof globalThis.crypto.randomUUID === "function") return;
  const getRandomValues =
    typeof globalThis.crypto.getRandomValues === "function"
      ? (arr) => globalThis.crypto.getRandomValues(arr)
      : (arr) => {
        for (let i = 0; i < arr.length; i++) arr[i] = (Math.random() * 256) & 0xff;
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
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const projectUrl = normalizeSupabaseProjectUrl(window.__SUPABASE_URL__);
  supabaseClient = createClient(projectUrl, window.__SUPABASE_ANON_KEY__, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof window !== "undefined" ? window.localStorage : undefined
    }
  });
  return supabaseClient;
}

function defaultConfigPayload() {
  return {
    id: 1,
    useTables: false,
    useServiceFee: true,
    activeTheme: "blue-service",
    categories: ["Bebidas", "Lanches", "Porcoes", "Pratos", "Sobremesas", "Outros"],
    prepCategories: [],
    paymentMethods: [
      { id: "card", name: "Cartao", active: true },
      { id: "cash", name: "Dinheiro", active: true },
      { id: "pix", name: "PIX", active: true },
      { id: "voucher", name: "Vale Ref.", active: true }
    ],
    shiftStartTime: "18:00",
    shiftEndTime: "02:00",
    shiftAutoOpen: true
  };
}

function productRowToApp(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: Number(row.price),
    requiresPrep: row.requires_prep === true
  };
}

function productToRow(p) {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    price: p.price,
    requires_prep: p.requiresPrep === true
  };
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

const DEFAULT_SHIFT_START = "18:00";
const DEFAULT_SHIFT_END = "02:00";

function getShiftSchedule(config) {
  const c = config || state.config || {};
  const start = String(c.shiftStartTime || DEFAULT_SHIFT_START).trim().slice(0, 5);
  const end = String(c.shiftEndTime || DEFAULT_SHIFT_END).trim().slice(0, 5);
  return {
    shiftStartTime: /^\d{2}:\d{2}$/.test(start) ? start : DEFAULT_SHIFT_START,
    shiftEndTime: /^\d{2}:\d{2}$/.test(end) ? end : DEFAULT_SHIFT_END,
    shiftAutoOpen: c.shiftAutoOpen !== false
  };
}

function parseHmToMinutes(hm) {
  const [h, m] = String(hm || "0:0").split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

function todayLocalYmdFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localDateFromYmd(ymd) {
  const [y, m, day] = String(ymd).slice(0, 10).split("-").map((n) => parseInt(n, 10));
  return new Date(y, m - 1, day);
}

function combineYmdAndHm(ymd, hm) {
  const d = localDateFromYmd(ymd);
  const [hh, mm] = String(hm).slice(0, 5).split(":").map((n) => parseInt(n, 10));
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d;
}

function postgresTimeFromHm(hm) {
  const s = String(hm).trim().slice(0, 5);
  return s.length === 5 ? `${s}:00` : "18:00:00";
}

/** Data de referencia do turno (ex.: madrugada de 27/05 ainda e turno do dia 26). */
function getOperationalReferenceDate(now, config) {
  const { shiftStartTime, shiftEndTime } = getShiftSchedule(config);
  const startM = parseHmToMinutes(shiftStartTime);
  const endM = parseHmToMinutes(shiftEndTime);
  const nowM = now.getHours() * 60 + now.getMinutes();
  const ymd = todayLocalYmdFromDate(now);
  if (endM <= startM) {
    if (nowM >= startM) return ymd;
    if (nowM < endM) {
      const prev = new Date(now);
      prev.setDate(prev.getDate() - 1);
      return todayLocalYmdFromDate(prev);
    }
    return null;
  }
  if (nowM >= startM && nowM < endM) return ymd;
  return null;
}

function getShiftWindowBounds(referenceDateYmd, startTime, endTime) {
  const windowStart = combineYmdAndHm(referenceDateYmd, startTime);
  let windowEnd = combineYmdAndHm(referenceDateYmd, endTime);
  if (windowEnd.getTime() <= windowStart.getTime()) {
    windowEnd = new Date(windowEnd);
    windowEnd.setDate(windowEnd.getDate() + 1);
  }
  return {
    windowStartAt: windowStart.toISOString(),
    windowEndAt: windowEnd.toISOString()
  };
}

function shiftRowToApp(row) {
  const ref =
    row.reference_date != null
      ? typeof row.reference_date === "string"
        ? row.reference_date.slice(0, 10)
        : String(row.reference_date).slice(0, 10)
      : "";
  const schedStart = row.scheduled_start != null ? String(row.scheduled_start).slice(0, 5) : DEFAULT_SHIFT_START;
  const schedEnd = row.scheduled_end != null ? String(row.scheduled_end).slice(0, 5) : DEFAULT_SHIFT_END;
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
    payload: row.payload && typeof row.payload === "object" ? row.payload : {}
  };
}

function loadShifts() {
  return state.cache.shifts || [];
}

function getOpenShift() {
  return loadShifts().find((s) => s.status === "aberto") || null;
}

function formatShiftLabel(shift) {
  if (!shift) return "";
  const ref = shift.referenceDate ? shift.referenceDate.split("-").reverse().join("/") : "";
  return `Turno ${ref} · ${shift.scheduledStart}–${shift.scheduledEnd}`;
}

function formatShiftWindowHint(shift) {
  if (!shift) return "";
  const a = new Date(shift.windowStartAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const b = new Date(shift.windowEndAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `${a} → ${b}`;
}

function orderBelongsToShift(order, shift) {
  if (!shift || normalizeOrderStatus(order.status) !== "Finalizado") return false;
  if (order.shiftId && String(order.shiftId) === String(shift.id)) return true;
  const closedIso = order.closedAt || order.createdAt;
  if (!closedIso) return false;
  const t = new Date(closedIso).getTime();
  const winStart = new Date(shift.windowStartAt).getTime();
  const winEnd = new Date(shift.windowEndAt).getTime();
  const shiftStart = new Date(shift.startedAt).getTime();
  const shiftEnd =
    shift.status === "fechado" && shift.endedAt
      ? new Date(shift.endedAt).getTime()
      : Math.min(Date.now(), winEnd);
  const from = Math.max(winStart, shiftStart);
  return t >= from && t <= shiftEnd;
}

function ordersFinalizedInShift(orders, shift) {
  if (!shift) return [];
  return orders.filter((o) => orderBelongsToShift(o, shift));
}

function ordersForDashboard(orders, shift) {
  const open = orders.filter((o) => normalizeOrderStatus(o.status) === "Aberta");
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
      sales: []
    };
  }
  const orders = loadOrders();
  const slice = ordersFinalizedInShift(orders, shift);
  const activeOrdersCount = orders.filter((o) => normalizeOrderStatus(o.status) === "Aberta").length;
  return {
    shiftId: shift.id,
    referenceDate: shift.referenceDate,
    activeOrdersCount,
    totalBruto: slice.reduce((s, o) => s + (o.totalPaid || 0), 0),
    finalizedOrdersCount: slice.length,
    sales: slice.map((order) => ({
      orderId: order.id,
      customer: (order.customer || "").trim() || "Cliente sem nome",
      totalPaid: order.totalPaid || 0,
      paymentMethods: Array.isArray(order.paymentMethods) ? order.paymentMethods : [],
      itemsCount: (order.items || []).reduce((sum, item) => sum + (item.qty || 0), 0),
      closedAt: order.closedAt || order.createdAt || null
    }))
  };
}

async function ensureProfile(session, supabase) {
  const { data } = await supabase.from("profiles").select("id").eq("id", session.user.id).maybeSingle();
  if (data) return;
  const { error } = await supabase.from("profiles").insert({
    id: session.user.id,
    display_name: session.user.email?.split("@")[0] || "Usuario",
    role: "Gerente"
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
    refresh_token: session.refresh_token
  });
  if (sessionErr) {
    console.warn("[JANA] setSession:", sessionErr.message);
  }
  await ensureProfile(session, supabase);

  const [pRes, cRes, sRes, dRes, cfgRes, profRes] = await Promise.all([
    supabase.from("products").select("*"),
    supabase.from("commandas").select("id, payload, status, created_at, updated_at, closed_at, shift_id"),
    supabase.from("shifts").select("*").order("started_at", { ascending: false }),
    supabase.from("daily_closes").select("id, payload, closed_at, date_ymd"),
    supabase.from("app_config").select("payload").maybeSingle(),
    supabase.from("profiles").select("display_name, role").eq("id", session.user.id).maybeSingle()
  ]);

  if (pRes.error) throw pRes.error;
  if (cRes.error) throw cRes.error;
  if (sRes.error) throw sRes.error;
  if (dRes.error) throw dRes.error;
  if (cfgRes.error) throw cfgRes.error;
  if (profRes.error) throw profRes.error;

  state.cache.products = (pRes.data || []).map(productRowToApp);
  state.cache.commandas = (cRes.data || []).map((r) => {
    const base = { ...(r.payload || {}), id: r.id };
    if (r.status != null && r.status !== "") base.status = r.status;
    if (r.closed_at != null) base.closedAt = r.closed_at;
    if (r.created_at != null) base.createdAt = r.created_at;
    if (r.shift_id != null) base.shiftId = r.shift_id;
    return base;
  });
  state.cache.shifts = (sRes.data || []).map(shiftRowToApp);
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
      dateYmd: dateYmd ?? p.dateYmd
    };
  });

  if (cfgRes.data?.payload && typeof cfgRes.data.payload === "object") {
    state.cache.config = { ...cfgRes.data.payload };
  } else {
    const def = defaultConfigPayload();
    const up = await supabase
      .from("app_config")
      .upsert({ user_id: session.user.id, payload: def }, { onConflict: "user_id" });
    if (up.error) throw up.error;
    state.cache.config = def;
  }

  const pr = profRes.data;
  setLoggedUser({
    id: session.user.id,
    email: session.user.email,
    username: pr?.display_name || session.user.email?.split("@")[0] || "Usuario",
    role: pr?.role || "Atendente"
  });

  state.config = loadConfig();
  await ensureOpenShift();
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
  const { error } = await sb.from("products").delete().eq("id", String(productId));
  if (error) throw error;
}

async function upsertCommandaRemote(order) {
  const sb = await getSupabase();
  if (!sb) return;
  const createdRaw = toIsoTimestamptz(order.createdAt) || new Date().toISOString();
  const row = {
    id: order.id,
    payload: commandaPayloadDocument(order),
    status: order.status || "Aberta",
    closed_at: toIsoTimestamptz(order.closedAt),
    created_at: createdRaw,
    shift_id: order.shiftId || null
  };
  const { error } = await sb.from("commandas").upsert(row);
  if (error) throw error;
}

async function deleteCommandaRemote(orderId) {
  const sb = await getSupabase();
  if (!sb) return;
  const { error } = await sb.from("commandas").delete().eq("id", String(orderId));
  if (error) throw error;
}

async function upsertAppConfigRemote(config) {
  const sb = await getSupabase();
  if (!sb) return;
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return;
  const { error } = await sb.from("app_config").upsert({ user_id: uid, payload: { ...config } }, { onConflict: "user_id" });
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
    date_ymd
  });
  if (error) throw error;
}

async function deleteDailyCloseRemote(closeId) {
  const sb = await getSupabase();
  if (!sb) return;
  const { error } = await sb.from("daily_closes").delete().eq("id", String(closeId));
  if (error) throw error;
}

async function insertShiftRemote(shift) {
  const sb = await getSupabase();
  if (!sb) throw new Error("Supabase indisponivel");
  const sched = getShiftSchedule(state.config);
  const bounds = getShiftWindowBounds(shift.referenceDate, sched.shiftStartTime, sched.shiftEndTime);
  const { data, error } = await sb
    .from("shifts")
    .insert({
      reference_date: shift.referenceDate,
      scheduled_start: postgresTimeFromHm(sched.shiftStartTime),
      scheduled_end: postgresTimeFromHm(sched.shiftEndTime),
      window_start_at: bounds.windowStartAt,
      window_end_at: bounds.windowEndAt,
      started_at: shift.startedAt || new Date().toISOString(),
      status: "aberto",
      payload: {}
    })
    .select("*")
    .single();
  if (error) throw error;
  return shiftRowToApp(data);
}

async function closeShiftRemote(shift, closePayload) {
  const sb = await getSupabase();
  if (!sb) throw new Error("Supabase indisponivel");
  const endedAt = new Date().toISOString();
  const { data, error } = await sb
    .from("shifts")
    .update({
      status: "fechado",
      ended_at: endedAt,
      payload: { closeSnapshot: closePayload, closedAt: endedAt }
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
  if (getOpenShift()) throw new Error("Ja existe um turno aberto.");
  const sched = getShiftSchedule(state.config);
  const ref = getOperationalReferenceDate(new Date(), state.config) || todayLocalYmd();
  const created = await insertShiftRemote({
    referenceDate: ref,
    startedAt: new Date().toISOString()
  });
  state.cache.shifts = [created, ...loadShifts().filter((s) => String(s.id) !== String(created.id))];
  return created;
}

async function ensureOpenShift() {
  if (getOpenShift()) return getOpenShift();
  const sched = getShiftSchedule(state.config);
  if (!sched.shiftAutoOpen) return null;
  const ref = getOperationalReferenceDate(new Date(), state.config);
  if (!ref) return null;
  try {
    return await openShiftManual();
  } catch (e) {
    console.warn("[JANA] ensureOpenShift", e);
    return null;
  }
}

async function persistShiftClose(shift) {
  const draft = computeCashCloseDraft(shift);
  const closed = await closeShiftRemote(shift, draft);
  const list = loadShifts().map((s) => (String(s.id) === String(closed.id) ? closed : s));
  state.cache.shifts = list;
  return closed;
}

async function rollbackLastClosedShift() {
  const closed = loadShifts()
    .filter((s) => s.status === "fechado" && s.endedAt)
    .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime());
  if (!closed.length) return false;
  if (getOpenShift()) throw new Error("Feche o turno aberto antes de estornar outro.");
  const target = closed[0];
  const reopened = await reopenShiftRemote(target.id);
  state.cache.shifts = loadShifts().map((s) => (String(s.id) === String(reopened.id) ? reopened : s));
  return true;
}

const PENDING_ORDER_ID = "__pending__";
let _pendingOrderPostChain = Promise.resolve();
/** Botao Adicionar item: estado de pressao para feedback visual. */
let addProductPressTarget = null;
/** Atualiza cronometros na lista da comanda (1s) */
let orderItemsTimerInterval = null;
const THEME_PRESETS = {
  "dark-pro": { label: "Dark Pro", description: "Escuro confortavel" },
  apple: { label: "Apple", description: "Limpo e sofisticado" },
  "blue-service": { label: "Blue Service", description: "Azul institucional" }
};

const state = {
  user: null,
  selectedFilter: "all",
  selectedOrderId: null,
  selectedTab: "dashboardTab",
  selectedSettingsTab: "products",
  selectedCategory: "Todas",
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
  cashClosePendingRollback: false,
  cashCloseHistoryExpandedId: null,
  config: {
    id: 1,
    useTables: false,
    useServiceFee: true,
    activeTheme: "blue-service",
    categories: ["Bebidas", "Lanches", "Porcoes", "Pratos", "Sobremesas", "Outros"],
    prepCategories: [],
    paymentMethods: [
      { id: "card", name: "Cartao", active: true },
      { id: "cash", name: "Dinheiro", active: true },
      { id: "pix", name: "PIX", active: true },
      { id: "voucher", name: "Vale Ref.", active: true }
    ]
  },
  cache: {
    commandas: [],
    products: [],
    config: {
      id: 1,
      useTables: false,
      useServiceFee: true,
      activeTheme: "blue-service",
      categories: ["Bebidas", "Lanches", "Porcoes", "Pratos", "Sobremesas", "Outros"],
      prepCategories: [],
      paymentMethods: [
        { id: "card", name: "Cartao", active: true },
        { id: "cash", name: "Dinheiro", active: true },
        { id: "pix", name: "PIX", active: true },
        { id: "voucher", name: "Vale Ref.", active: true }
      ]
    },
    dailyCloses: [],
    shifts: []
  }
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
  shiftStartTimeInput: document.querySelector("#shiftStartTimeInput"),
  shiftEndTimeInput: document.querySelector("#shiftEndTimeInput"),
  shiftAutoOpenToggle: document.querySelector("#shiftAutoOpenToggle"),
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
  closeCheckoutDialogButton: document.querySelector("#closeCheckoutDialogButton"),
  checkoutSummary: document.querySelector("#checkoutSummary"),
  checkoutPaymentMethodsList: document.querySelector("#checkoutPaymentMethodsList"),
  serviceFeeField: document.querySelector("#serviceFeeField"),
  serviceFeeInput: document.querySelector("#serviceFeeInput"),
  confirmCheckoutButton: document.querySelector("#confirmCheckoutButton"),
  checkoutFeedback: document.querySelector("#checkoutFeedback"),
  cashCloseHistoryDialog: document.querySelector("#cashCloseHistoryDialog"),
  closeCashCloseHistoryButton: document.querySelector("#closeCashCloseHistoryButton"),
  cashCloseHistoryBody: document.querySelector("#cashCloseHistoryBody"),
  productForm: document.querySelector("#productForm"),
  productIdInput: document.querySelector("#productIdInput"),
  productSubmitButton: document.querySelector("#productSubmitButton"),
  productNameInput: document.querySelector("#productNameInput"),
  productCategoryInput: document.querySelector("#productCategoryInput"),
  productPriceInput: document.querySelector("#productPriceInput"),
  productRequiresPrepInput: document.querySelector("#productRequiresPrepInput"),
  clearProductFormButton: document.querySelector("#clearProductFormButton"),
  productsList: document.querySelector("#productsList"),
  tableModeToggle: document.querySelector("#tableModeToggle"),
  serviceFeeToggle: document.querySelector("#serviceFeeToggle"),
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
  paymentMethodsSettingsList: document.querySelector("#paymentMethodsSettingsList"),
  activeThemeLabel: document.querySelector("#activeThemeLabel"),
  themePresetList: document.querySelector("#themePresetList"),
  confirmSettingsButton: document.querySelector("#confirmSettingsButton"),
  reopenFilterDateInput: document.querySelector("#reopenFilterDateInput"),
  reopenSearchButton: document.querySelector("#reopenSearchButton"),
  reopenOrdersList: document.querySelector("#reopenOrdersList"),
  reopenPanelFeedback: document.querySelector("#reopenPanelFeedback"),
  reopenConfirmDialog: document.querySelector("#reopenConfirmDialog"),
  reopenConfirmAcceptButton: document.querySelector("#reopenConfirmAcceptButton"),
  reopenConfirmDismissButton: document.querySelector("#reopenConfirmDismissButton"),
  reportsDateFromInput: document.querySelector("#reportsDateFromInput"),
  reportsDateToInput: document.querySelector("#reportsDateToInput"),
  reportsPicker: document.querySelector("#reportsPicker"),
  reportsDetail: document.querySelector("#reportsDetail"),
  reportsDetailBody: document.querySelector("#reportsDetailBody"),
  reportsBackButton: document.querySelector("#reportsBackButton")
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
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function loadProducts() {
  return state.cache.products;
}

function saveProducts(products) {
  state.cache.products = products;
  void (async () => {
    for (const product of products) {
      if (product.id === undefined || product.id === null || product.id === "") continue;
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
      if (order.id === undefined || order.id === null || order.id === "") continue;
      try {
        await upsertCommandaRemote(order);
      } catch (e) {
        console.error("[JANA] saveOrders", e);
      }
    }
  })();
}

function loadClosedShiftsForHistory() {
  return loadShifts()
    .filter((s) => s.status === "fechado")
    .sort((a, b) => new Date(b.endedAt || 0).getTime() - new Date(a.endedAt || 0).getTime());
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
            const refLabel = row.referenceDate ? row.referenceDate.split("-").reverse().join("/") : "";
            return `
          <li class="rounded-lg border border-outline-variant px-3 py-2 text-xs">
            <button type="button" class="cash-close-history-toggle w-full text-left" data-close-id="${rowId}">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="font-semibold text-on-surface">Turno ${refLabel} · ${row.scheduledStart}–${row.scheduledEnd}</p>
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
                    ${sales.length
                      ? `
                        <ul class="mt-1 space-y-1">
                          ${sales
                            .map(
                              (sale) => `
                            <li class="rounded border border-outline-variant px-2 py-1">
                              <p class="font-semibold text-on-surface">${sale.customer || "Cliente sem nome"} • ${formatCurrency(sale.totalPaid || 0)}</p>
                              <p class="text-[10px] text-on-surface-variant">Itens: ${sale.itemsCount ?? 0} • Pagamento: ${(sale.paymentMethods || []).join(", ") || "Nao informado"}</p>
                            </li>`
                            )
                            .join("")}
                        </ul>`
                      : "<p class='mt-1 text-[10px] text-on-surface-variant'>Sem detalhes de vendas neste fechamento.</p>"}
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
    activeTheme: "blue-service",
    categories: ["Bebidas", "Lanches", "Porcoes", "Pratos", "Sobremesas", "Outros"],
    prepCategories: [],
    paymentMethods: [
      { id: "card", name: "Cartao", active: true },
      { id: "cash", name: "Dinheiro", active: true },
      { id: "pix", name: "PIX", active: true },
      { id: "voucher", name: "Vale Ref.", active: true }
    ],
    shiftStartTime: DEFAULT_SHIFT_START,
    shiftEndTime: DEFAULT_SHIFT_END,
    shiftAutoOpen: true
  };
  const config = state.cache.config || fallback;
  const sched = getShiftSchedule(config);
  return {
    ...fallback,
    ...config,
    ...sched,
    activeTheme: THEME_PRESETS[config.activeTheme] ? config.activeTheme : fallback.activeTheme,
    categories: Array.isArray(config.categories) && config.categories.length ? config.categories : fallback.categories,
    prepCategories: Array.isArray(config.prepCategories) ? config.prepCategories : fallback.prepCategories,
    paymentMethods: Array.isArray(config.paymentMethods) && config.paymentMethods.length ? config.paymentMethods : fallback.paymentMethods
  };
}

function saveConfig(config) {
  state.cache.config = config;
  void upsertAppConfigRemote(config).catch((e) => console.error("[JANA] saveConfig", e));
}

function applyTheme() {
  const theme = state.config.activeTheme || "blue-service";
  document.documentElement.setAttribute("data-theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const themeColorByKey = {
      apple: "#0071e3",
      "blue-service": "#00234b",
      "dark-pro": "#13161c"
    };
    meta.setAttribute("content", themeColorByKey[theme] || "#fbf9fc");
  }
}

function updateSettingsTabsHints() {
  if (!refs.settingsTabsScroll || !refs.settingsTabsLeftHint || !refs.settingsTabsRightHint) return;
  const scroller = refs.settingsTabsScroll;
  const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  const hasOverflow = maxScrollLeft > 2;
  const showLeft = hasOverflow && scroller.scrollLeft > 4;
  const showRight = hasOverflow && scroller.scrollLeft < (maxScrollLeft - 4);
  refs.settingsTabsLeftHint.classList.toggle("show", showLeft);
  refs.settingsTabsRightHint.classList.toggle("show", showRight);
}

function updateCategoryTabsHints() {
  if (!refs.categoryTabsScroll || !refs.categoryTabsLeftHint || !refs.categoryTabsRightHint) return;
  const content = refs.categoryButtons;
  if (!content) return;
  const maxScrollLeft = Math.max(0, content.scrollWidth - content.clientWidth);
  const hasOverflow = maxScrollLeft > 2;
  const showLeft = hasOverflow && content.scrollLeft > 4;
  const showRight = hasOverflow && content.scrollLeft < (maxScrollLeft - 4);
  refs.categoryTabsLeftHint.classList.toggle("show", showLeft);
  refs.categoryTabsRightHint.classList.toggle("show", showRight);
}

function isPendingLocalOrder() {
  return state.pendingNewOrder != null && state.selectedOrderId === PENDING_ORDER_ID;
}

function getCurrentOrder() {
  if (isPendingLocalOrder()) return state.pendingNewOrder;
  return loadOrders().find((order) => String(order.id) === String(state.selectedOrderId));
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
      const key = item.productId != null && item.productId !== "" ? `id:${item.productId}` : `name:${item.name || ""}`;
      const cur = byKey.get(key) || { name: item.name || key, qty: 0, revenue: 0 };
      cur.qty += item.qty || 0;
      cur.revenue += (item.price || 0) * (item.qty || 0);
      if (item.name) cur.name = item.name;
      byKey.set(key, cur);
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.qty - a.qty)
    .slice(0, limit);
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
  return { counts, revenue, peakHourIndex: counts.some((c) => c > 0) ? maxIdx : null };
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
  return { counts, revenue, peakWeekdayIndex: counts.some((c) => c > 0) ? maxIdx : null };
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
  if (status === "Finalizado" || status === "Cancelada" || status === "Aberta") return status;
  // Compatibilidade com status legado.
  if (status === "Aguardando" || status === "Em curso") return "Aberta";
  return "Aberta";
}

function deriveOrderStatus(order) {
  if (order.status === "Finalizado" || order.status === "Cancelada") return order.status;
  return "Aberta";
}

function formatTimeShort(isoDate) {
  if (!isoDate) return "";
  return new Date(isoDate).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
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
  document.querySelectorAll(".order-line-timer[data-requested-at]").forEach((el) => {
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
    (order.items || []).some((item) => item.requiresPrep && item.requestedAt && !item.deliveredAt);
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
  const item = order.items.find((entry) => String(entry.lineId) === String(lineId));
  if (!item || item.deliveredAt || !item.requiresPrep) return;
  item.deliveredAt = new Date().toISOString();
  item.serviceSeconds = computeServiceSeconds(item.requestedAt, item.deliveredAt);

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
  if (st === "Finalizado") return localYmdFromIso(order.closedAt || order.createdAt);
  if (st === "Cancelada") return localYmdFromIso(order.canceledAt || order.createdAt);
  return "";
}

function performReopenOrder(orderId) {
  const orders = loadOrders();
  const target = orders.find((o) => String(o.id) === String(orderId));
  if (!target) return false;
  const st = normalizeOrderStatus(target.status);
  if (st !== "Finalizado" && st !== "Cancelada") return false;
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

function renderReopenPanel() {
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
      const eventIso = st === "Finalizado" ? order.closedAt || order.createdAt : order.canceledAt || order.createdAt;
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
    btn.addEventListener("click", () => openReopenConfirmDialog(btn.dataset.orderId));
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

function createNewOrderAndOpen() {
  state.pendingNewOrder = {
    table: "",
    customer: "",
    status: "Aberta",
    items: [],
    paymentMethods: [],
    serviceFeePercent: 10,
    totalPaid: 0,
    createdAt: new Date().toISOString(),
    everHadItems: false
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
  state.pendingNewOrder = null;
  state.selectedOrderId = null;
}

function renderAuth() {
  hideAuthBootScreen();
  applyTheme();
  if (state.user) {
    refs.loginScreen.classList.add("hidden");
    refs.appScreen.classList.remove("hidden");
    refs.currentUserLabel.textContent = `${state.user.username} (${state.user.role})`;
    state.pendingNewOrder = null;
    if (state.selectedOrderId === PENDING_ORDER_ID) state.selectedOrderId = null;
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
  const sched = getShiftSchedule(state.config);
  if (shift) {
    refs.shiftBar.innerHTML = `
      <div class="rounded-xl border border-primary/30 bg-primary-container/40 px-3 py-2.5">
        <p class="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">Turno em andamento</p>
        <p class="text-sm font-extrabold text-primary">${formatShiftLabel(shift)}</p>
        <p class="mt-0.5 text-[10px] text-on-surface-variant">${formatShiftWindowHint(shift)}</p>
      </div>`;
    if (refs.openShiftButton) refs.openShiftButton.classList.add("hidden");
  } else {
    const refHint = getOperationalReferenceDate(new Date(), state.config);
    refs.shiftBar.innerHTML = `
      <div class="rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2.5">
        <p class="text-sm font-semibold text-on-surface">Nenhum turno aberto</p>
        <p class="mt-0.5 text-[10px] text-on-surface-variant">Horario configurado: ${sched.shiftStartTime} – ${sched.shiftEndTime}${refHint ? ` · referencia hoje: ${refHint.split("-").reverse().join("/")}` : " · fora do horario de turno"}</p>
      </div>`;
    if (refs.openShiftButton) refs.openShiftButton.classList.remove("hidden");
  }
}

function renderDashboard() {
  renderShiftBar();
  const orders = loadOrders();
  const shift = getOpenShift();
  const finalizedInShift = shift ? ordersFinalizedInShift(orders, shift) : [];
  const active = orders.filter((order) => normalizeOrderStatus(order.status) === "Aberta");
  const scopedOrders = ordersForDashboard(orders, shift);

  if (refs.dailySalesCount) refs.dailySalesCount.textContent = String(finalizedInShift.length);
  refs.activeOrdersCount.textContent = String(active.length);
  refs.dailyRevenueValue.textContent = formatCurrency(
    finalizedInShift.reduce((s, o) => s + (o.totalPaid || 0), 0)
  );

  const filtered = scopedOrders.filter((order) => {
    if (state.selectedFilter === "all") return true;
    return normalizeOrderStatus(order.status) === state.selectedFilter;
  });

  if (!filtered.length) {
    refs.ordersList.innerHTML = "<li class='rounded-xl border border-outline-variant bg-surface-container-lowest p-4 text-sm text-on-surface-variant'>Nenhuma comanda neste filtro.</li>";
    return;
  }

  refs.ordersList.innerHTML = filtered
    .map((order) => {
      const subtotal = calculateOrderSubtotal(order);
      const status = normalizeOrderStatus(order.status);
      const badgeColor = status === "Finalizado"
        ? "bg-secondary-container text-on-secondary-container"
        : status === "Cancelada"
          ? "bg-error-container text-error"
          : "bg-primary-fixed text-on-primary-fixed-variant";
      const isLocked = status === "Finalizado" || status === "Cancelada";
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
          <div class="mt-3 grid grid-cols-2 gap-2">
            <button class="order-open-button h-touch-target-min w-full rounded-xl bg-primary text-sm font-bold text-on-primary ${isLocked ? "opacity-50" : ""}" data-order-id="${order.id}" ${isLocked ? "disabled" : ""}>Abrir</button>
            <button class="order-finalize-button h-touch-target-min w-full rounded-xl border border-outline-variant bg-surface text-sm font-bold text-primary ${isLocked || status !== "Aberta" || !order.items?.length ? "opacity-50" : ""}" data-order-id="${order.id}" ${isLocked || status !== "Aberta" || !order.items?.length ? "disabled" : ""}>Finalizar</button>
          </div>
        </li>
      `;
    })
    .join("");

  document.querySelectorAll(".order-open-button").forEach((button) => {
    button.addEventListener("click", () => openDetailDialog(button.dataset.orderId));
  });
  document.querySelectorAll(".order-finalize-button").forEach((button) => {
    button.addEventListener("click", () => void beginFinalizeFlowForOrderId(button.dataset.orderId));
  });
}

function renderBottomTabs() {
  refs.tabPanels.forEach((panel) => panel.classList.add("hidden"));
  document.querySelector(`#${state.selectedTab}`)?.classList.remove("hidden");

  refs.bottomTabs.forEach((tab) => {
    const selected = tab.dataset.tab === state.selectedTab;
    tab.className = selected
      ? "bottom-tab bottom-tab--active flex flex-1 items-center justify-center rounded-[0.875rem] bg-primary-container text-on-primary-container transition active:scale-[0.98]"
      : "bottom-tab flex flex-1 items-center justify-center rounded-[0.875rem] text-on-surface-variant transition active:scale-[0.98] hover:bg-surface-container-high/60";
    tab.setAttribute("aria-selected", selected ? "true" : "false");
  });
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
    ...categories.map((category) => `<option value="${category}">${category}</option>`)
  ].join("");
  if (current && categories.includes(current)) {
    refs.productCategoryInput.value = current;
  }
}

function renderSettings() {
  refs.settingsPanels.forEach((panel) => panel.classList.add("hidden"));
  const panelMap = {
    products: document.querySelector("#productsSettingsPanel"),
    operation: document.querySelector("#operationSettingsPanel"),
    categories: document.querySelector("#categoriesSettingsPanel"),
    payments: document.querySelector("#paymentsSettingsPanel"),
    reopen: document.querySelector("#reopenSettingsPanel"),
    theme: document.querySelector("#themeSettingsPanel")
  };
  panelMap[state.selectedSettingsTab]?.classList.remove("hidden");
  refs.settingsTabButtons.forEach((button) => {
    const selected = button.dataset.settingsTab === state.selectedSettingsTab;
    button.className = selected
      ? "settings-tab-button h-10 flex-1 rounded-full bg-primary-container px-3 text-xs font-bold text-on-primary-container"
      : "settings-tab-button h-10 flex-1 rounded-full bg-surface-container-high px-3 text-xs font-bold text-on-surface-variant";
  });
  updateSettingsTabsHints();

  refs.tableModeToggle.checked = !!state.config.useTables;
  refs.serviceFeeToggle.checked = !!state.config.useServiceFee;
  refs.serviceFeeField?.classList.toggle("hidden", !state.config.useServiceFee);
  const sched = getShiftSchedule(state.config);
  if (refs.shiftStartTimeInput) refs.shiftStartTimeInput.value = sched.shiftStartTime;
  if (refs.shiftEndTimeInput) refs.shiftEndTimeInput.value = sched.shiftEndTime;
  if (refs.shiftAutoOpenToggle) refs.shiftAutoOpenToggle.checked = sched.shiftAutoOpen;
  renderProductCategoryOptions();

  refs.categoriesList.innerHTML = (state.config.categories || [])
    .map((category) => `
      <li class="flex items-center justify-between rounded-lg border border-outline-variant px-3 py-2">
        <div class="flex items-center gap-2">
          <input class="category-prep-toggle h-4 w-4" type="checkbox" data-category="${category}" ${categoryRequiresPrep(category) ? "checked" : ""}>
          <span class="text-sm font-semibold text-on-surface">${category}</span>
          <span class="text-[10px] text-on-surface-variant">preparo</span>
        </div>
        <button class="delete-category-button h-8 rounded-md border border-error-container bg-error-container px-2 text-xs font-bold text-error" data-category="${category}">Excluir</button>
      </li>
    `)
    .join("");

  document.querySelectorAll(".category-prep-toggle").forEach((toggle) => {
    toggle.addEventListener("change", () => {
      const category = toggle.dataset.category;
      if (!category) return;
      const next = new Set(state.config.prepCategories || []);
      if (toggle.checked) next.add(category);
      else next.delete(category);
      state.config.prepCategories = [...next];
      saveConfig(state.config);
      renderAll();
    });
  });

  document.querySelectorAll(".delete-category-button").forEach((button) => {
    button.addEventListener("click", () => deleteCategory(button.dataset.category));
  });

  refs.paymentMethodsSettingsList.innerHTML = (state.config.paymentMethods || [])
    .map((method) => `
      <li class="flex items-center justify-between gap-2 rounded-lg border border-outline-variant px-3 py-2">
        <div class="flex items-center gap-2">
          <input class="payment-method-active-toggle h-4 w-4" type="checkbox" data-method-id="${method.id}" ${method.active ? "checked" : ""}>
          <span class="text-sm font-semibold text-on-surface">${method.name}</span>
        </div>
        <button class="delete-payment-method-button h-8 rounded-md border border-error-container bg-error-container px-2 text-xs font-bold text-error" data-method-id="${method.id}">Excluir</button>
      </li>
    `)
    .join("");

  document.querySelectorAll(".payment-method-active-toggle").forEach((toggle) => {
    toggle.addEventListener("change", () => {
      const target = state.config.paymentMethods.find((method) => method.id === toggle.dataset.methodId);
      if (!target) return;
      target.active = toggle.checked;
      saveConfig(state.config);
      renderCheckoutPaymentMethods();
    });
  });
  document.querySelectorAll(".delete-payment-method-button").forEach((button) => {
    button.addEventListener("click", () => deletePaymentMethod(button.dataset.methodId));
  });

  refs.activeThemeLabel.textContent = `Tema ativo: ${THEME_PRESETS[state.config.activeTheme]?.label || "Blue Service"}`;
  refs.themePresetList.innerHTML = Object.entries(THEME_PRESETS)
    .map(([key, preset]) => `
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
    `)
    .join("");
  refs.themePresetList.querySelectorAll(".theme-mini-card").forEach((card) => {
    card.setAttribute("data-theme", card.dataset.themePreview || "blue-service");
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
}

function renderProductAdmin() {
  const products = loadProducts();

  if (!products.length) {
    refs.productsList.innerHTML = "<li class='rounded-xl border border-outline-variant bg-surface-container-lowest p-4 text-sm text-on-surface-variant'>Nenhum produto cadastrado.</li>";
    return;
  }

  refs.productsList.innerHTML = products
    .map((product) => `
      <li class="rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm">
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="text-sm font-bold text-primary">${product.name}</p>
            <p class="text-xs text-on-surface-variant">${product.category}</p>
            <p class="mt-1 text-sm font-extrabold text-primary">${formatCurrency(product.price)}</p>
          </div>
          <div class="flex gap-2">
            <button class="product-edit-button h-10 rounded-lg border border-outline-variant px-3 text-xs font-semibold" data-product-id="${product.id}">Editar</button>
            <button class="product-delete-button h-10 rounded-lg border border-error-container bg-error-container px-3 text-xs font-semibold text-error" data-product-id="${product.id}">Excluir</button>
          </div>
        </div>
      </li>
    `)
    .join("");

  document.querySelectorAll(".product-edit-button").forEach((button) => {
    button.addEventListener("click", () => fillProductForm(button.dataset.productId));
  });

  document.querySelectorAll(".product-delete-button").forEach((button) => {
    button.addEventListener("click", () => deleteProduct(button.dataset.productId));
  });
}

function renderCategoryOptions() {
  if (!refs.categoryButtons) return;
  const configuredCategories = (state.config.categories || []).filter(Boolean);
  const productCategories = loadProducts().map((product) => product.category).filter(Boolean);
  const categories = ["Todas", ...new Set([...configuredCategories, ...productCategories])];
  if (!categories.includes(state.selectedCategory)) {
    state.selectedCategory = "Todas";
  }
  refs.categoryButtons.innerHTML = categories
    .map((category) => `
      <button class="category-filter-button h-10 whitespace-nowrap rounded-full px-3 text-xs font-bold ${category === state.selectedCategory ? "bg-primary-container text-on-primary-container" : "bg-surface-container-high text-on-surface-variant"}" data-category="${category}">
        ${category}
      </button>
    `)
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
  if (refs.detailCustomerHint) {
    refs.detailCustomerHint.textContent = launchMode
      ? "Depois de lançar os itens, informe o nome e use Confirmar."
      : "Visualização da comanda — edite o nome aqui se precisar.";
  }
  if (refs.detailCustomerSection && refs.detailCustomerSlotTop && refs.detailCustomerSlotBottom) {
    if (launchMode) {
      refs.detailCustomerSlotBottom.appendChild(refs.detailCustomerSection);
    } else {
      refs.detailCustomerSlotTop.appendChild(refs.detailCustomerSection);
    }
    refs.detailCustomerSlotTop.classList.toggle("hidden", launchMode);
    refs.detailCustomerSlotBottom.classList.toggle("hidden", !launchMode);
  }

  const status = normalizeOrderStatus(order.status);
  const isLocked = status === "Finalizado" || status === "Cancelada";

  if (refs.orderTableGroup) {
    refs.orderTableGroup.classList.toggle("hidden", !state.config.useTables);
  }
  if (refs.orderTableInput) {
    refs.orderTableInput.value = state.config.useTables ? order.table || "" : "";
    refs.orderTableInput.disabled = isLocked;
  }
  refs.addFlowContent.classList.toggle("hidden", state.detailAction !== "add");
  refs.cancelConfirmBox.classList.toggle("hidden", !state.cancelConfirmOpen);
  refs.openCancelFlowButton.disabled = isLocked;
  refs.openCancelFlowButton.className = isLocked
    ? "mt-2 h-touch-target-min w-full rounded-xl border border-outline-variant bg-surface-container-high text-sm font-bold text-on-surface-variant opacity-50"
    : "mt-2 h-touch-target-min w-full rounded-xl border border-error-container bg-surface text-sm font-bold text-error shadow-sm transition active:scale-[0.98]";

  const filteredProducts = products.filter((product) => {
    const byCategory = state.selectedCategory === "Todas" || product.category === state.selectedCategory;
    const byName = product.name.toLowerCase().includes(state.productSearch.toLowerCase());
    return byCategory && byName;
  });

  refs.availableProductsList.innerHTML = filteredProducts.length
    ? filteredProducts
      .map((product) => `
        <li class="rounded-xl border border-slate-200 p-2">
          <p class="text-sm font-semibold">${product.name}</p>
          <p class="text-xs text-slate-500">${product.category} • ${formatCurrency(product.price)}</p>
          <button type="button" class="add-product-button mt-2 h-10 w-full select-none rounded-lg bg-brand-700 text-sm font-semibold text-white shadow-sm" data-product-id="${product.id}">Adicionar</button>
        </li>
      `)
      .join("")
    : "<li class='rounded-xl border border-slate-200 p-3 text-sm text-slate-500'>Nenhum produto encontrado.</li>";

  const items = order.items || [];
  const itemsHtml = items.length
    ? items
      .map((item, index) => {
        const showTimer =
          item.requiresPrep && item.requestedAt && !item.deliveredAt && !isLocked;
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
        const showDeliverBtn = !isLocked && item.requiresPrep && item.requestedAt && !item.deliveredAt;
        const lineIdAttr = item.lineId ? ` data-line-id="${item.lineId}"` : "";
        return `
        <li class="rounded-xl border border-slate-200 p-2">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold">${item.name}</p>
              <p class="text-xs text-slate-500">${formatCurrency(item.price)} cada</p>
              ${
                showTimer
                  ? `<p class="order-line-timer mt-0.5 text-[11px] tabular-nums tracking-tight text-on-surface-variant"${lineIdAttr} data-requested-at="${item.requestedAt}">${formatElapsedClock(
                    item.requestedAt
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
              <div class="flex items-center gap-2">
                <button class="qty-minus h-10 w-10 rounded-lg border border-slate-300 text-lg font-bold" data-index="${index}">-</button>
                <span class="w-6 text-center text-sm font-bold">${item.qty}</span>
                <button class="qty-plus h-10 w-10 rounded-lg border border-slate-300 text-lg font-bold" data-index="${index}">+</button>
              </div>
            </div>
          </div>
        </li>`;
      })
      .join("")
    : "<li class='rounded-xl border border-slate-200 p-3 text-sm text-slate-500'>Nenhum item lancado.</li>";
  refs.orderItemsList.innerHTML = itemsHtml;
  refs.orderSubtotalLabel.textContent = `Subtotal: ${formatCurrency(calculateOrderSubtotal(order))}`;

  document.querySelectorAll(".add-product-button").forEach((button) => {
    if (button.dataset.bound === "1") return;
    button.dataset.bound = "1";
    const fire = () => {
      const productId = String(button.dataset.productId || "");
      void addItemToOrder(productId);
    };
    button.addEventListener("click", fire);
  });

  document.querySelectorAll(".qty-plus").forEach((button) => {
    button.addEventListener("click", () => changeItemQty(Number(button.dataset.index), 1));
  });
  document.querySelectorAll(".qty-minus").forEach((button) => {
    button.addEventListener("click", () => changeItemQty(Number(button.dataset.index), -1));
  });

  document.querySelectorAll(".mark-delivered-button").forEach((button) => {
    button.addEventListener("click", () => markLineDelivered(button.dataset.lineId));
  });

  syncOrderLineTimerElements();
  syncOrderItemsTimerInterval();
}

function renderCheckoutSummary() {
  const order = getCurrentOrder();
  if (!order) return;
  const subtotal = calculateOrderSubtotal(order);
  const feePercent = state.config.useServiceFee ? (Number(refs.serviceFeeInput.value) || 0) : 0;
  const feeValue = subtotal * (feePercent / 100);
  const total = subtotal + feeValue;

  refs.checkoutSummary.innerHTML = `
    <p class="flex justify-between text-sm"><span>Subtotal</span><span class="font-semibold">${formatCurrency(subtotal)}</span></p>
    <p class="flex justify-between text-sm"><span>Taxa (${feePercent.toFixed(1)}%)</span><span class="font-semibold">${formatCurrency(feeValue)}</span></p>
    <p class="flex justify-between border-t border-slate-200 pt-2 text-base font-bold"><span>Total</span><span>${formatCurrency(total)}</span></p>
  `;
}

function renderCheckoutPaymentMethods() {
  const activeMethods = (state.config.paymentMethods || []).filter((method) => method.active);
  refs.checkoutPaymentMethodsList.innerHTML = activeMethods.length
    ? activeMethods
      .map((method) => `
        <label class="flex h-touch-target-min items-center gap-2 rounded-xl border border-outline-variant px-3 text-sm">
          <input class="payment-method" type="checkbox" value="${method.name}" data-method-id="${method.id}">
          ${method.name}
        </label>
      `)
      .join("")
    : "<p class='col-span-2 rounded-lg border border-outline-variant bg-surface-container-high p-3 text-sm text-on-surface-variant'>Nenhuma forma de pagamento ativa. Ative em Config.</p>";
}

function renderReports() {
  if (!refs.reportsPicker || !refs.reportsDetail || !refs.reportsDetailBody) return;

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

  if (refs.reportsDateFromInput) refs.reportsDateFromInput.value = state.reportDateFrom;
  if (refs.reportsDateToInput) refs.reportsDateToInput.value = state.reportDateTo;

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
    daily: "Vendas no periodo",
    revenue: "Faturamento",
    payments: "Formas de pagamento",
    products: "Itens mais vendidos",
    peakHour: "Horario de pico",
    weekday: "Dias da semana",
    cashClose: "Fechamento de caixa"
  };
  const title = titleMap[state.selectedReport] || "Relatorio";

  let body = "";
  if (state.selectedReport === "daily") {
    body = `
      <p class="text-xs uppercase text-on-surface-variant">${fromYmd === toYmd ? `Data ${fromYmd}` : `${fromYmd} a ${toYmd}`}</p>
      <p class="mt-3 text-sm text-on-surface-variant">Comandas finalizadas</p>
      <p class="text-2xl font-extrabold text-primary">${orderCount}</p>
      <p class="mt-3 text-sm text-on-surface-variant">Total pago (soma)</p>
      <p class="text-2xl font-extrabold text-secondary">${formatCurrency(totalRev)}</p>
    `;
  } else if (state.selectedReport === "revenue") {
    body = `
      <p class="text-xs uppercase text-on-surface-variant">${fromYmd === toYmd ? `Data ${fromYmd}` : `${fromYmd} a ${toYmd}`}</p>
      <p class="mt-3 text-sm text-on-surface-variant">Faturamento (total pago)</p>
      <p class="text-2xl font-extrabold text-primary">${formatCurrency(totalRev)}</p>
      <p class="mt-2 text-xs text-on-surface-variant">${orderCount} comanda(s) no periodo.</p>
    `;
  } else if (state.selectedReport === "payments") {
    const shares = aggregatePaymentMethodShares(slice);
    const rows = paymentSharesSorted(shares);
    body = `
      <p class="text-xs uppercase text-on-surface-variant">${fromYmd === toYmd ? `Data ${fromYmd}` : `${fromYmd} a ${toYmd}`}</p>
      <p class="mt-2 text-[11px] text-on-surface-variant">Valores estimados: quando ha mais de uma forma no mesmo fechamento, o total e dividido igualmente entre elas.</p>
      <ul class="mt-3 space-y-2">
        ${rows.length
          ? rows
            .map(
              (row) => `
          <li class="flex justify-between rounded-lg border border-outline-variant px-3 py-2 text-sm">
            <span>${row.name}</span>
            <span class="font-bold text-primary">${formatCurrency(row.value)}</span>
          </li>`
            )
            .join("")
          : "<li class='text-sm text-on-surface-variant'>Nenhum pagamento no periodo.</li>"}
      </ul>
    `;
  } else if (state.selectedReport === "products") {
    const top = aggregateTopProducts(slice, 20);
    body = `
      <p class="text-xs uppercase text-on-surface-variant">${fromYmd === toYmd ? `Data ${fromYmd}` : `${fromYmd} a ${toYmd}`}</p>
      <ul class="mt-3 space-y-2">
        ${top.length
          ? top
            .map(
              (row) => `
          <li class="flex justify-between gap-2 rounded-lg border border-outline-variant px-3 py-2 text-sm">
            <span class="min-w-0 flex-1">${row.name}</span>
            <span class="shrink-0 font-semibold text-on-surface">${row.qty} un.</span>
            <span class="shrink-0 font-bold text-primary">${formatCurrency(row.revenue)}</span>
          </li>`
            )
            .join("")
          : "<li class='text-sm text-on-surface-variant'>Nenhum item no periodo.</li>"}
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
  } else if (state.selectedReport === "cashClose") {
    const uiMsg = state.cashCloseUiMessage;
    state.cashCloseUiMessage = null;
    const shift = getOpenShift();
    const savePending = state.cashClosePendingClose;
    const rollbackPending = state.cashClosePendingRollback;
    const draft = computeCashCloseDraft(shift);
    if (!shift) {
      body = `
        <p class="text-sm text-on-surface-variant">Nao ha turno aberto. Abra um turno no Inicio antes de fechar o caixa.</p>
        <button type="button" id="openCashCloseHistoryButton" class="mt-3 h-touch-target-min w-full rounded-xl border border-outline-variant bg-surface-container-low text-sm font-bold text-on-surface">Ver historico de turnos fechados</button>`;
    } else {
      body = `
      <p class="text-xs text-on-surface-variant">Fecha o <strong>turno atual</strong> (${formatShiftLabel(shift)}). Inclui todas as comandas finalizadas neste turno, mesmo apos a meia-noite.</p>
      <p class="mt-1 text-[10px] text-on-surface-variant">${formatShiftWindowHint(shift)}</p>
      <div class="mt-stack-md grid grid-cols-2 gap-2">
        <div class="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2">
          <p class="text-[10px] font-semibold uppercase text-on-surface-variant">Em aberto</p>
          <p class="text-xl font-extrabold text-primary">${draft.activeOrdersCount}</p>
        </div>
        <div class="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2">
          <p class="text-[10px] font-semibold uppercase text-on-surface-variant">Total bruto</p>
          <p class="text-xl font-extrabold text-secondary">${formatCurrency(draft.totalBruto)}</p>
        </div>
      </div>
      <p class="mt-2 text-xs text-on-surface-variant">${draft.finalizedOrdersCount} comanda(s) finalizada(s) neste turno.</p>
      <div class="mt-stack-md grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button type="button" id="saveCashCloseButton" class="h-touch-target-min w-full rounded-xl text-sm font-bold ${savePending ? "bg-secondary text-on-secondary" : "bg-primary text-on-primary"}">${savePending ? "Confirmar fechamento" : "Fechar turno"}</button>
        <button type="button" id="rollbackCashCloseButton" class="h-touch-target-min w-full rounded-xl border text-sm font-bold ${rollbackPending ? "border-error bg-error text-on-error" : "border-outline-variant bg-surface-container-low text-on-surface"}">${rollbackPending ? "Confirmar estorno" : "Reabrir ultimo turno fechado"}</button>
      </div>
      <button type="button" id="openCashCloseHistoryButton" class="mt-2 h-touch-target-min w-full rounded-xl border border-outline-variant bg-surface-container-low text-sm font-bold text-on-surface">Ver historico de turnos fechados</button>
      <p id="cashCloseFeedback" class="mt-2 min-h-[1rem] text-xs ${uiMsg?.type === "err" ? "text-error" : uiMsg?.type === "ok" ? "text-secondary" : uiMsg?.type === "warn" ? "text-primary" : "text-on-surface-variant"}">${uiMsg?.text || ""}</p>`;
    }
  } else {
    body = "<p class='text-sm text-on-surface-variant'>Selecione um tipo na lista.</p>";
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

function openDetailDialog(orderId, options = {}) {
  state.pendingNewOrder = null;
  state.selectedOrderId = orderId;
  state.productSearch = "";
  state.selectedCategory = "Todas";
  state.cancelConfirmOpen = false;
  state.currentView = "detail";
  refs.productSearchInput.value = "";

  const row = loadOrders().find((entry) => String(entry.id) === String(orderId));
  const status = row ? normalizeOrderStatus(row.status) : "Aberta";
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
  state.pendingNewOrder = null;
  state.selectedOrderId = orderId;
  const order = loadOrders().find((entry) => String(entry.id) === String(orderId));
  if (!order || !order.items?.length) return;

  const customerName = (order.customer || "").trim();
  if (!customerName) {
    openDetailDialog(orderId, { detailAction: null });
    refs.detailCustomerFeedback.textContent = "Informe o nome do cliente antes de finalizar.";
    return;
  }

  refs.detailCustomerFeedback.textContent = "";
  refs.checkoutFeedback.textContent = "";
  refs.serviceFeeInput.value = String(state.config.useServiceFee ? (order.serviceFeePercent || 10) : 0);
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
  const product = products.find((entry) => String(entry.id) === String(productId));
  if (!product) return;

  const requiresPrep = product.requiresPrep ?? categoryRequiresPrep(product.category);

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
          prepStatus: requiresPrep ? "Aguardando" : null
        });
      }
      order.everHadItems = true;
      order.status = deriveOrderStatus(order);
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
  const order = orders.find((entry) => String(entry.id) === String(state.selectedOrderId));
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
      prepStatus: requiresPrep ? "Aguardando" : null
    });
  }
  order.everHadItems = true;
  order.status = deriveOrderStatus(order);
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
      prepStatus: item.requiresPrep ? "Aguardando" : null
    });
  } else {
    item.qty += delta;
    if (item.qty <= 0) {
      order.items.splice(itemIndex, 1);
    }
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

function fillProductForm(productId) {
  const product = loadProducts().find((entry) => String(entry.id) === String(productId));
  if (!product) return;
  state.selectedTab = "settingsTab";
  state.selectedSettingsTab = "products";
  renderAll();
  refs.productIdInput.value = product.id;
  refs.productNameInput.value = product.name;
  const hasCategoryOption = [...refs.productCategoryInput.options].some((option) => option.value === product.category);
  if (!hasCategoryOption) {
    const option = document.createElement("option");
    option.value = product.category;
    option.textContent = `${product.category} (legada)`;
    refs.productCategoryInput.appendChild(option);
  }
  refs.productCategoryInput.value = product.category;
  refs.productPriceInput.value = product.price;
  refs.productRequiresPrepInput.checked = product.requiresPrep ?? categoryRequiresPrep(product.category);
  refs.productSubmitButton.textContent = "Atualizar";
  refs.productNameInput.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearProductForm() {
  refs.productForm.reset();
  refs.productIdInput.value = "";
  refs.productSubmitButton.textContent = "Salvar";
}

function deleteCategory(categoryName) {
  const hasProductsUsingCategory = loadProducts().some((product) => product.category === categoryName);
  if (hasProductsUsingCategory) {
    refs.categoryFeedback.textContent = "Nao e possivel excluir: existem produtos nessa categoria.";
    return;
  }
  state.config.categories = state.config.categories.filter((category) => category !== categoryName);
  state.config.prepCategories = (state.config.prepCategories || []).filter((category) => category !== categoryName);
  saveConfig(state.config);
  refs.categoryFeedback.textContent = "";
  renderAll();
}

function deletePaymentMethod(methodId) {
  const methods = state.config.paymentMethods || [];
  if (methods.length <= 1) {
    refs.paymentMethodFeedback.textContent = "Mantenha ao menos uma forma de pagamento.";
    return;
  }
  state.config.paymentMethods = methods.filter((method) => method.id !== methodId);
  saveConfig(state.config);
  refs.paymentMethodFeedback.textContent = "";
  renderAll();
}

function deleteProduct(productId) {
  const products = loadProducts().filter((product) => String(product.id) !== String(productId));
  void deleteProductRemote(productId).catch((e) => console.error("[JANA] deleteProduct", e));
  saveProducts(products);
  renderAll();
}

function bindAddProductListInteractionsOnce() {
  const list = refs.availableProductsList;
  if (!list || list.dataset.boundAddProduct === "1") return;
  list.dataset.boundAddProduct = "1";

  list.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest(".add-product-button");
    if (!btn || !list.contains(btn)) return;
    if (addProductPressTarget && addProductPressTarget !== btn) {
      addProductPressTarget.classList.remove("is-pressed");
    }
    addProductPressTarget = btn;
    btn.classList.add("is-pressed");
  });

  const releaseAddProductPress = () => {
    if (addProductPressTarget) {
      addProductPressTarget.classList.remove("is-pressed");
      addProductPressTarget = null;
    }
  };

  document.addEventListener("pointerup", releaseAddProductPress);
  document.addEventListener("pointercancel", releaseAddProductPress);
}

function bindDetailCustomerViewportAssistOnce() {
  // Intencionalmente sem ajuste: deixa o navegador/sistema lidar com teclado virtual.
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
      const { data: signData, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        refs.loginFeedback.textContent = error.message || "Credenciais invalidas.";
        return;
      }
      refs.loginForm.reset();
      if (signData.session) {
        await applySupabaseSession(signData.session);
      } else {
        refs.loginFeedback.textContent = "Login ok mas sessao vazia. Atualize a pagina.";
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
        state.cashCloseUiMessage = { type: "ok", text: "Turno aberto." };
        renderAll();
      } catch (e) {
        console.error(e);
        state.cashCloseUiMessage = {
          type: "err",
          text: (e && e.message) || "Nao foi possivel abrir o turno."
        };
        renderDashboard();
      }
    })();
  });

  const persistShiftScheduleFromInputs = () => {
    if (refs.shiftStartTimeInput) state.config.shiftStartTime = refs.shiftStartTimeInput.value || DEFAULT_SHIFT_START;
    if (refs.shiftEndTimeInput) state.config.shiftEndTime = refs.shiftEndTimeInput.value || DEFAULT_SHIFT_END;
    if (refs.shiftAutoOpenToggle) state.config.shiftAutoOpen = refs.shiftAutoOpenToggle.checked;
    saveConfig(state.config);
  };
  refs.shiftStartTimeInput?.addEventListener("change", persistShiftScheduleFromInputs);
  refs.shiftEndTimeInput?.addEventListener("change", persistShiftScheduleFromInputs);
  refs.shiftAutoOpenToggle?.addEventListener("change", persistShiftScheduleFromInputs);

  refs.newOrderButton.addEventListener("click", createNewOrderAndOpen);
  refs.closeOrderDialogButton.addEventListener("click", () => refs.orderDialog.close());

  refs.bottomTabs.forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTab = button.dataset.tab || "dashboardTab";
      if (state.selectedTab === "dashboardTab") {
        state.currentView = "main";
        state.detailAction = null;
        state.cancelConfirmOpen = false;
        state.pendingNewOrder = null;
        if (state.selectedOrderId === PENDING_ORDER_ID) state.selectedOrderId = null;
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
    refs.reportsDetail.addEventListener("click", (e) => {
      const button = e.target.closest("button");
      if (!button) return;
      if (button.id === "openCashCloseHistoryButton") {
        e.preventDefault();
        openCashCloseHistoryDialog();
        return;
      }
      const isSave = button.id === "saveCashCloseButton";
      const isRollback = button.id === "rollbackCashCloseButton";
      if (!isSave && !isRollback) return;
      e.preventDefault();
      const shift = getOpenShift();
      void (async () => {
        try {
          if (isSave) {
            if (!shift) {
              state.cashCloseUiMessage = { type: "err", text: "Nenhum turno aberto." };
              renderReports();
              return;
            }
            if (!state.cashClosePendingClose) {
              state.cashClosePendingClose = true;
              state.cashClosePendingRollback = false;
              state.cashCloseUiMessage = {
                type: "warn",
                text: 'Clique novamente em "Confirmar fechamento" para encerrar o turno.'
              };
              renderReports();
              return;
            }
            await persistShiftClose(shift);
            state.cashClosePendingClose = false;
            state.cashClosePendingRollback = false;
            state.cashCloseUiMessage = { type: "ok", text: "Turno fechado com sucesso." };
          } else {
            if (!state.cashClosePendingRollback) {
              state.cashClosePendingRollback = true;
              state.cashClosePendingClose = false;
              state.cashCloseUiMessage = {
                type: "warn",
                text: 'Clique novamente para reabrir o ultimo turno fechado.'
              };
              renderReports();
              return;
            }
            const removed = await rollbackLastClosedShift();
            state.cashClosePendingRollback = false;
            state.cashCloseUiMessage = removed
              ? { type: "ok", text: "Ultimo turno reaberto." }
              : { type: "err", text: "Nao ha turno fechado para reabrir." };
          }
          renderDashboard();
          renderReports();
          if (!refs.cashCloseHistoryDialog?.classList.contains("hidden")) {
            renderCashCloseHistoryOverlay();
          }
        } catch (err) {
          console.error(err);
          state.cashClosePendingClose = false;
          state.cashClosePendingRollback = false;
          state.cashCloseUiMessage = {
            type: "err",
            text: isSave
              ? (err?.message || "Nao foi possivel fechar o turno.")
              : (err?.message || "Nao foi possivel reabrir o turno.")
          };
          renderReports();
        }
      })();
    });
  }

  refs.orderForm.addEventListener("submit", (event) => {
    event.preventDefault();
    createNewOrderAndOpen();
    refs.orderForm.reset();
    refs.orderDialog.close();
  });

  refs.settingsTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedSettingsTab = button.dataset.settingsTab;
      renderSettings();
    });
  });

  refs.settingsTabsScroll?.addEventListener("scroll", updateSettingsTabsHints);
  refs.categoryButtons?.addEventListener("scroll", updateCategoryTabsHints);
  window.addEventListener("resize", updateSettingsTabsHints);
  window.addEventListener("resize", updateCategoryTabsHints);

  refs.closeDetailDialogButton.addEventListener("click", () => {
    state.currentView = "main";
    state.detailAction = null;
    state.cancelConfirmOpen = false;
    state.pendingNewOrder = null;
    if (state.selectedOrderId === PENDING_ORDER_ID) state.selectedOrderId = null;
    renderView();
  });

  refs.confirmDetailButton.addEventListener("click", () => {
    const customerName = refs.detailCustomerInput.value.trim();
    if (!customerName) {
      refs.detailCustomerFeedback.textContent = "Informe o nome do cliente para confirmar.";
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
      state.pendingNewOrder = null;
      state.selectedOrderId = null;
      state.currentView = "main";
      state.detailAction = null;
      state.cancelConfirmOpen = false;
      renderAll();
      return;
    }
    if (order) {
      const orders = loadOrders();
      const target = orders.find((entry) => String(entry.id) === String(order.id));
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
      refs.detailCustomerFeedback.textContent = "Nome do cliente é obrigatório.";
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
    const target = orders.find((entry) => String(entry.id) === String(order.id));
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
      state.pendingNewOrder = null;
      state.selectedOrderId = null;
      state.cancelConfirmOpen = false;
      state.currentView = "main";
      state.detailAction = null;
      renderAll();
      return;
    }

    const orders = loadOrders();
    const targetIndex = orders.findIndex((entry) => String(entry.id) === String(state.selectedOrderId));
    if (targetIndex < 0) return;
    const target = orders[targetIndex];
    if (target.id === undefined || target.id === null || target.id === "") return;

    const temItensNaComanda = Array.isArray(target.items) && target.items.length > 0;

    if (!temItensNaComanda) {
      try {
        await deleteCommandaRemote(target.id);
      } catch (_) {
        /* servidor indisponivel */
      }
      orders.splice(targetIndex, 1);
      state.cache.commandas = orders;
    } else {
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
    state.currentView = "detail";
    renderView();
  });
  refs.closeCashCloseHistoryButton?.addEventListener("click", closeCashCloseHistoryDialog);
  refs.cashCloseHistoryBody?.addEventListener("click", (e) => {
    const button = e.target.closest(".cash-close-history-toggle");
    if (!button) return;
    const id = String(button.dataset.closeId || "");
    if (!id) return;
    state.cashCloseHistoryExpandedId = state.cashCloseHistoryExpandedId === id ? null : id;
    renderCashCloseHistoryOverlay();
  });
  refs.serviceFeeInput.addEventListener("input", renderCheckoutSummary);

  refs.confirmCheckoutButton.addEventListener("click", () => {
    const order = getCurrentOrder();
    if (!order) return;
    const paymentMethods = [...document.querySelectorAll(".payment-method:checked")].map((checkbox) => checkbox.value);
    if (!paymentMethods.length) {
      refs.checkoutFeedback.textContent = "Selecione ao menos uma forma de pagamento.";
      return;
    }
    const subtotal = calculateOrderSubtotal(order);
    const serviceFeePercent = state.config.useServiceFee ? (Number(refs.serviceFeeInput.value) || 0) : 0;
    const serviceFee = subtotal * (serviceFeePercent / 100);
    const totalPaid = subtotal + serviceFee;

    const orders = loadOrders();
    const target = orders.find((entry) => String(entry.id) === String(order.id));
    if (!target) return;
    const openShift = getOpenShift();
    if (!openShift) {
      refs.checkoutFeedback.textContent = "Abra um turno no Inicio antes de finalizar a comanda.";
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
    const productData = {
      name: refs.productNameInput.value.trim(),
      category: refs.productCategoryInput.value.trim(),
      price: Number(refs.productPriceInput.value),
      requiresPrep: refs.productRequiresPrepInput.checked
    };
    if (!productData.name || !productData.category || Number.isNaN(productData.price)) return;

    if (refs.productIdInput.value) {
      const target = products.find((product) => String(product.id) === String(refs.productIdInput.value));
      if (target) {
        target.name = productData.name;
        target.category = productData.category;
        target.price = productData.price;
        target.requiresPrep = productData.requiresPrep;
      }
    } else {
      const newProduct = { ...productData, id: crypto.randomUUID() };
      products.unshift(newProduct);
      void (async () => {
        try {
          await upsertProductRemote(newProduct);
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

  refs.categoryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    refs.categoryFeedback.textContent = "";
    const name = refs.categoryNameInput.value.trim();
    if (!name) return;

    const exists = state.config.categories.some((category) => category.toLowerCase() === name.toLowerCase());
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

    const exists = (state.config.paymentMethods || []).some((method) => method.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      refs.paymentMethodFeedback.textContent = "Forma de pagamento ja cadastrada.";
      return;
    }

    state.config.paymentMethods.push({
      id: crypto.randomUUID(),
      name,
      active: true
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
  refs.reopenFilterDateInput?.addEventListener("change", () => renderReopenPanel());

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

  bindAddProductListInteractionsOnce();
}

/** iOS Safari ainda dispara double-tap zoom mesmo com viewport maximum-scale=1. Bloqueia. */
function bindIosDoubleTapBlocker() {
  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (e) => {
      const now = Date.now();
      if (now - lastTouchEnd < 350) e.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false }
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
    { passive: true }
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
    { passive: true }
  );
  el.addEventListener(
    "touchend",
    () => {
      if (tracking && maxPull >= 72) window.location.reload();
      tracking = false;
      maxPull = 0;
    },
    { passive: true }
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
      data: { session: existingSession }
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

init();
