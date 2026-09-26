import { describe, expect, it } from "vitest";

import {
  checkShippingCost,
  DEFAULT_PACKING_COST_PAISE,
  MAX_SHIPPING_COST_PAISE,
  planDeliverOrder,
  planPackOrder,
  planShipOrder,
  type PackingBatchView,
} from "./shipments";

function batches(...rows: PackingBatchView[]): ReadonlyMap<string, PackingBatchView> {
  return new Map(rows.map((r) => [r.ref, r]));
}

describe("checkShippingCost", () => {
  it("takes zero and a normal packing cost", () => {
    expect(checkShippingCost(0, "Packing cost")).toEqual({ ok: true, value: 0 });
    expect(checkShippingCost(4000, "Packing cost")).toEqual({ ok: true, value: 4000 });
  });

  it("refuses a negative amount", () => {
    const result = checkShippingCost(-1, "Packing cost");
    expect(result.ok).toBe(false);
  });

  it("refuses anything above the named ceiling", () => {
    const result = checkShippingCost(MAX_SHIPPING_COST_PAISE + 1, "Packing cost");
    expect(result.ok).toBe(false);
  });

  it("takes the ceiling itself", () => {
    expect(checkShippingCost(MAX_SHIPPING_COST_PAISE, "Packing cost").ok).toBe(true);
  });

  it("refuses a fraction of a paisa", () => {
    expect(checkShippingCost(40.5, "Packing cost").ok).toBe(false);
  });

  it("reads null or undefined as zero", () => {
    expect(checkShippingCost(null, "Courier cost")).toEqual({ ok: true, value: 0 });
    expect(checkShippingCost(undefined, "Courier cost")).toEqual({ ok: true, value: 0 });
  });
});

describe("planPackOrder", () => {
  it("refuses an order that is not in To pack", () => {
    const result = planPackOrder(batches(), {
      orderId: "o-1",
      state: "packed",
      lines: [{ batchRef: "b-1", qty: 2 }],
      packingCostPaise: DEFAULT_PACKING_COST_PAISE,
    });
    expect(result.ok).toBe(false);
  });

  it("assigns jar numbers starting after the batch's own count", () => {
    const result = planPackOrder(batches({ ref: "b-1", jarsAssigned: 5, bottledJars: 22 }), {
      orderId: "o-1",
      state: "toPack",
      lines: [{ batchRef: "b-1", qty: 3 }],
      packingCostPaise: 4000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.jarNumbersByLine).toEqual([[6, 7, 8]]);
    expect(result.value.jarsAssignedByBatch.get("b-1")).toBe(8);
    expect(result.value.packingCostPaise).toBe(4000);
  });

  it("gives a custom line (no batch) no jar numbers at all", () => {
    const result = planPackOrder(batches(), {
      orderId: "o-1",
      state: "toPack",
      lines: [{ batchRef: null, qty: 1 }],
      packingCostPaise: 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.jarNumbersByLine).toEqual([[]]);
  });

  it("keeps two lines of the same batch in one running sequence, in line order", () => {
    const result = planPackOrder(batches({ ref: "b-1", jarsAssigned: 0, bottledJars: 22 }), {
      orderId: "o-1",
      state: "toPack",
      lines: [
        { batchRef: "b-1", qty: 2 },
        { batchRef: "b-1", qty: 1 },
      ],
      packingCostPaise: 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.jarNumbersByLine).toEqual([[1, 2], [3]]);
      expect(result.value.jarsAssignedByBatch.get("b-1")).toBe(3);
    }
  });

  it("refuses to hand out a jar number past what the batch actually bottled", () => {
    const result = planPackOrder(batches({ ref: "b-1", jarsAssigned: 20, bottledJars: 22 }), {
      orderId: "o-1",
      state: "toPack",
      lines: [{ batchRef: "b-1", qty: 5 }],
      packingCostPaise: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("failed-precondition");
  });

  it("refuses a batch reference it was not handed a view for", () => {
    const result = planPackOrder(batches(), {
      orderId: "o-1",
      state: "toPack",
      lines: [{ batchRef: "b-missing", qty: 1 }],
      packingCostPaise: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not-found");
  });

  it("refuses a packing cost outside the sane range", () => {
    const result = planPackOrder(batches({ ref: "b-1", jarsAssigned: 0, bottledJars: 22 }), {
      orderId: "o-1",
      state: "toPack",
      lines: [{ batchRef: "b-1", qty: 1 }],
      packingCostPaise: -1,
    });
    expect(result.ok).toBe(false);
  });
});

describe("planShipOrder", () => {
  const validConsignment = (v: unknown) => v === "EE123456789IN";

  it("refuses an order that has not been packed", () => {
    const result = planShipOrder(
      { state: "toPack", fulfilment: "ship", consignmentNumber: "EE123456789IN", courierCostPaise: null },
      validConsignment,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("This order has not been packed yet.");
  });

  it("tells an already-shipped order it has already shipped, not that it is unpacked", () => {
    const result = planShipOrder(
      { state: "shipped", fulfilment: "ship", consignmentNumber: "EE123456789IN", courierCostPaise: null },
      validConsignment,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("This order has already been marked shipped.");
  });

  it("tells an already-delivered order it has already been delivered, not that it is unpacked", () => {
    const result = planShipOrder(
      { state: "delivered", fulfilment: "ship", consignmentNumber: "EE123456789IN", courierCostPaise: null },
      validConsignment,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("This order has already been delivered.");
  });

  it("refuses an order that does not ship by courier", () => {
    const result = planShipOrder(
      { state: "packed", fulfilment: "handedOver", consignmentNumber: "EE123456789IN", courierCostPaise: null },
      validConsignment,
    );
    expect(result.ok).toBe(false);
  });

  it("refuses a consignment number that is not the right shape", () => {
    const result = planShipOrder(
      { state: "packed", fulfilment: "ship", consignmentNumber: "not-a-number", courierCostPaise: null },
      validConsignment,
    );
    expect(result.ok).toBe(false);
  });

  it("takes a good consignment number and upper-cases it", () => {
    const result = planShipOrder(
      { state: "packed", fulfilment: "ship", consignmentNumber: "ee123456789in", courierCostPaise: 5000 },
      (v) => v === "EE123456789IN",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.awb).toBe("EE123456789IN");
      expect(result.value.courierCostPaise).toBe(5000);
    }
  });
});

describe("planDeliverOrder", () => {
  it("takes a shipped order to delivered", () => {
    expect(planDeliverOrder({ state: "shipped", fulfilment: "ship" }).ok).toBe(true);
  });

  it("takes a packed hand delivery straight to delivered", () => {
    expect(planDeliverOrder({ state: "packed", fulfilment: "handedOver" }).ok).toBe(true);
  });

  it("refuses a packed order that ships by courier: it has not shipped yet", () => {
    const result = planDeliverOrder({ state: "packed", fulfilment: "ship" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("This order has not been shipped yet.");
  });

  it("refuses an order that has not even been packed", () => {
    const result = planDeliverOrder({ state: "toPack", fulfilment: "handedOver" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("This order has not been packed yet.");
  });

  it("tells an already-delivered order it has already been delivered, whichever fulfilment it used", () => {
    const shipped = planDeliverOrder({ state: "delivered", fulfilment: "ship" });
    expect(shipped.ok).toBe(false);
    if (!shipped.ok) expect(shipped.message).toBe("This order has already been delivered.");

    const byHand = planDeliverOrder({ state: "delivered", fulfilment: "handedOver" });
    expect(byHand.ok).toBe(false);
    if (!byHand.ok) expect(byHand.message).toBe("This order has already been delivered.");
  });
});
