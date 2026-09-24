// Must stay the first line: it calls setGlobalOptions as a module-load side
// effect, and every export below (via ./api, ./auth) must be evaluated after
// that call so the platform-wide default is already in place. In the tsc
// CommonJS output, `export ... from` compiles to a `require` hoisted in
// source order, so this import runs first.
import "./lib/options";

export { api } from "./api";
export { answerApproval } from "./approvals";
export { setRole } from "./auth";
export { createCounterSale, voidCounterSale } from "./orders";
export { billForOrder, onDocumentIssued } from "./money";
export {
  approveBatchFull,
  onBatchUpdateWritten,
  onBatchWritten,
  onOrderWritten,
  transitionBatch,
} from "./batches";
