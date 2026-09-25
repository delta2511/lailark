/**
 * The counter sale (brief 7A), M2.8.
 *
 * Two callables, and the pure planner behind them. Nothing here messages a
 * customer and nothing here takes money through a gateway: a counter sale is
 * cash or UPI taken by hand, or a payment link that M3 will send.
 */
export { createCounterSale } from "./createCounterSale";
export { voidCounterSale } from "./voidCounterSale";

/**
 * The web checkout (brief 6 and 7), M3.5. `createCheckout` takes the hold
 * and creates the Razorpay order; `sweepHolds` tidies the ones nobody paid.
 */
export { createCheckout } from "./createCheckout";
export { sweepHolds } from "./sweepHolds";
