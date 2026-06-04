import { vi } from "vitest";

/**
 * Mock minimalista do cliente Supabase para funções *Remote e bootstrap.
 * @param {object} [handlers]
 */
export function createSupabaseMock(handlers = {}) {
  const chain = (table) => {
    const resultFor = (key) => handlers[key] ?? handlers[table] ?? { data: null, error: null };

    const api = {
      select: vi.fn(() => api),
      insert: vi.fn(() => api),
      upsert: vi.fn(() => api),
      update: vi.fn(() => api),
      delete: vi.fn(() => api),
      eq: vi.fn(() => api),
      order: vi.fn(() => api),
      maybeSingle: vi.fn(async () => resultFor(`${table}:maybeSingle`)),
      single: vi.fn(async () => resultFor(`${table}:single`)),
      then(onFulfilled, onRejected) {
        return Promise.resolve(resultFor(table)).then(onFulfilled, onRejected);
      }
    };
    return api;
  };

  return {
    from: vi.fn((table) => chain(table)),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1", email: "gerente@test.com" } } })),
      getSession: vi.fn(async () => ({ data: { session: null } })),
      setSession: vi.fn(async () => ({ error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }))
    },
    rpc: vi.fn(async (name) => handlers[`rpc:${name}`] ?? { error: null, data: null })
  };
}

export function createNoopSupabaseMock() {
  return createSupabaseMock();
}
