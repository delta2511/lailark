/**
 * Packing and India Post, brief §11.1 and §11.3, M4.1: `toPack -> packed ->
 * shipped -> delivered`, or `packed -> delivered` directly for a hand
 * delivery. Three callables, and the pure planner behind them
 * (`./shipments.ts`).
 */
export { packOrder } from "./packOrder";
export { shipOrder } from "./shipOrder";
export { deliverOrder } from "./deliverOrder";
