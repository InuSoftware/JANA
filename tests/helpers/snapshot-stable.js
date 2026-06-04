/**
 * Utilitários para snapshots determinísticos (sem new Date(), ordem estável).
 */

/** Ordena chaves de objetos recursivamente (arrays de objetos por `sortKey`). */
export function sortKeysDeep(value, sortKey = "id") {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const sorted = value.map((item) => sortKeysDeep(item, sortKey));
    if (sorted.length && typeof sorted[0] === "object" && sorted[0] !== null && sortKey in sorted[0]) {
      return [...sorted].sort((a, b) => String(a[sortKey]).localeCompare(String(b[sortKey])));
    }
    return sorted;
  }
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortKeysDeep(value[key], sortKey);
  }
  return out;
}

/** Converte mapa de agregação em lista ordenada para snapshot. */
export function paymentSharesForSnapshot(map) {
  return Object.entries(map || {})
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Remove campos voláteis de documentos de comanda antes do snapshot. */
export function orderDocForSnapshot(order) {
  const doc = { ...order };
  delete doc.id;
  if (Array.isArray(doc.items)) {
    doc.items = [...doc.items]
      .map((item) => {
        const { lineId, requestedAt, deliveredAt, ...rest } = item;
        return sortKeysDeep(rest, "productId");
      })
      .sort((a, b) => String(a.productId).localeCompare(String(b.productId)));
  }
  if (Array.isArray(doc.paymentMethods)) {
    doc.paymentMethods = [...doc.paymentMethods].sort();
  }
  return sortKeysDeep(doc, "productId");
}

/** Turno legado → campos estáveis (sem ISO derivados de timezone local). */
export function shiftLikeStableFields(shiftLike) {
  return {
    id: shiftLike.id,
    referenceDate: shiftLike.referenceDate,
    status: shiftLike.status,
    scheduledStart: shiftLike.scheduledStart,
    scheduledEnd: shiftLike.scheduledEnd,
    legacyDailyClose: Boolean(shiftLike.payload?.legacyDailyClose),
    closeSnapshot: shiftLike.payload?.closeSnapshot
      ? {
          dateYmd: shiftLike.payload.closeSnapshot.dateYmd,
          activeOrdersCount: shiftLike.payload.closeSnapshot.activeOrdersCount,
          totalBruto: shiftLike.payload.closeSnapshot.totalBruto,
          finalizedOrdersCount: shiftLike.payload.closeSnapshot.finalizedOrdersCount,
          salesCount: (shiftLike.payload.closeSnapshot.sales || []).length
        }
      : null
  };
}

/** Rascunho de fechamento sem timestamps de venda (só estrutura + totais). */
export function cashCloseDraftForSnapshot(draft) {
  return {
    shiftId: draft.shiftId,
    referenceDate: draft.referenceDate,
    activeOrdersCount: draft.activeOrdersCount,
    totalBruto: draft.totalBruto,
    finalizedOrdersCount: draft.finalizedOrdersCount,
    sales: (draft.sales || [])
      .map((s) => ({
        orderId: s.orderId,
        customer: s.customer,
        totalPaid: s.totalPaid,
        paymentMethods: [...(s.paymentMethods || [])].sort(),
        itemsCount: s.itemsCount
      }))
      .sort((a, b) => String(a.orderId).localeCompare(String(b.orderId)))
  };
}
