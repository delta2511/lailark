/**
 * M2.15: the single source of truth for "why can't this sale be saved yet."
 *
 * Before this file existed, `NewSale.tsx` wrote `canSave` as nine `&&`'d
 * booleans and, next to it, wrote `outstanding` as a second, separately
 * maintained list of user-facing reasons meant to explain the same nine
 * booleans. They drifted: a Kitchen custom line with nothing set up in
 * Products made `lineReady` false (so Save correctly went dead) but never
 * appeared in `outstanding` (so nothing next to the dead button said why).
 * That is the exact failure this task exists to close, so the fix is not
 * "add the missing branch," it is "make there be only one list." `canSave`
 * below is `!saving && outstanding.length === 0` and nothing else: a new
 * precondition that is not named in `computeOutstanding` cannot silently
 * make Save disabled with an empty panel, because there is no longer a
 * second place for it to be forgotten.
 *
 * The one exception is `saving`: it is not a problem with the sale, only a
 * moment the sale is in, so it is not a named item and is not part of
 * `computeOutstanding`.
 */
import type { Paise } from "@lailark/shared";

import { parseIndianMobile } from "../phone";
import { SELL } from "../copy";

export interface OutstandingItem {
  readonly id: string;
  readonly message: string;
  /** The id of the element `jumpTo` scrolls to and focuses. */
  readonly targetId: string;
}

export type SaleFulfilment = "handedOver" | "ship" | "collect";

/**
 * Everything `computeOutstanding` needs, already reduced to the plain
 * values `NewSale.tsx` has worked out from its own state (parsed phone,
 * discount verdict, and so on): this module does no Firestore reading and
 * no money maths of its own, so a unit test can drive it with plain data.
 */
export interface SaveGateInput {
  readonly phoneText: string;
  readonly phoneProblem: string | null;
  readonly phoneE164: string | null;
  readonly needsName: boolean;
  readonly shownName: string;
  readonly askingNewCustomer: boolean;

  readonly isCustom: boolean;
  readonly mayChangePrice: boolean;
  readonly customDescription: string;
  readonly customAmount: Paise | null;
  readonly offeredCustomLinesCount: number;
  readonly hasBatch: boolean;

  readonly qtyOk: boolean;

  readonly priceProblem: string | null;
  readonly discountProblem: string | null;
  readonly total: Paise;

  readonly fulfilment: SaleFulfilment;
  readonly addressReady: boolean;
  readonly addressName: string;
  readonly addressPhone: string;
  readonly addressLines: string;
  readonly addressCity: string;
  readonly addressState: string;
}

/**
 * Every reason `SaveGateInput` describes a sale that cannot be saved yet,
 * in the order the seven steps of brief 7A.1 read (who, what, how much, how
 * it goes), one item per reason, each pointed at the field it belongs to.
 */
export function computeOutstanding(input: SaveGateInput): OutstandingItem[] {
  const items: OutstandingItem[] = [];

  /* ---- 1. Customer ---- */

  if (input.phoneText.trim() === "") {
    items.push({ id: "phone", message: SELL.outstandingPhone, targetId: "sale-phone" });
  } else if (input.phoneProblem !== null) {
    items.push({ id: "phone", message: input.phoneProblem, targetId: "sale-phone" });
  }

  if (input.needsName && input.shownName.trim() === "") {
    items.push({ id: "name", message: SELL.outstandingName, targetId: "sale-name" });
  }

  if (input.askingNewCustomer && input.shownName.trim() !== "") {
    items.push({ id: "confirm", message: SELL.outstandingConfirm, targetId: "confirm-new-customer" });
  }

  /* ---- 2. What ----
   *
   * This mirrors `lineReady` exactly, branch for branch, so the two cannot
   * drift again:
   *   isCustom ? (description !== "" && amount !== null && amount >= 1)
   *             : batch !== null
   * The kitchen's two custom sub-cases (an offered line to pick, or none
   * set up at all) both come down to "no description yet": brief 7A.6, the
   * kitchen can only tap one of the Owner's lines, never type one, and the
   * tap sets the description and the amount together, so an empty
   * description is the one way this branch is ever unready for the
   * kitchen, whether or not the Owner has set any lines to offer.
   */
  if (input.isCustom) {
    if (input.mayChangePrice) {
      if (input.customDescription.trim() === "") {
        items.push({ id: "line", message: SELL.customLineNeedsDescription, targetId: "custom-description" });
      } else if (input.customAmount === null || input.customAmount < 1) {
        items.push({ id: "line", message: SELL.customLineNeedsAmount, targetId: "custom-amount" });
      }
    } else if (input.customDescription.trim() === "") {
      items.push(
        input.offeredCustomLinesCount > 0
          ? { id: "line", message: SELL.customLinePick, targetId: "custom-line-options" }
          : { id: "line", message: SELL.outstandingCustomLineNone, targetId: "sale-line-kind-jar" },
      );
    }
  } else if (!input.hasBatch) {
    items.push({ id: "line", message: SELL.outstandingProduct, targetId: "sale-product" });
  }

  if (!input.qtyOk) {
    items.push({ id: "qty", message: SELL.qtyInvalid, targetId: "sale-qty" });
  }

  /* ---- 3. Amount ---- */

  if (input.priceProblem !== null) {
    items.push({ id: "price", message: input.priceProblem, targetId: "sale-unit-price" });
  }

  if (input.discountProblem !== null) {
    items.push({ id: "discount", message: input.discountProblem, targetId: "sale-discount" });
  } else if (input.total < 0) {
    // Not reachable today (a discount that clears `checkDiscount` cannot
    // exceed the subtotal), kept as the safety net `total >= 0` always was.
    items.push({ id: "discount", message: SELL.outstandingTotal, targetId: "sale-discount" });
  }

  /* ---- 4. Fulfilment ---- */

  if (input.fulfilment === "ship" && !input.addressReady) {
    if (input.addressName.trim() === "") {
      items.push({ id: "address", message: SELL.outstandingAddressName, targetId: "address-name" });
    } else if (!parseIndianMobile(input.addressPhone).ok) {
      items.push({ id: "address", message: SELL.outstandingAddressPhone, targetId: "address-phone" });
    } else if (input.addressLines.trim() === "") {
      items.push({ id: "address", message: SELL.outstandingAddressLines, targetId: "address-lines" });
    } else if (input.addressCity.trim() === "") {
      items.push({ id: "address", message: SELL.outstandingAddressCity, targetId: "address-city" });
    } else if (input.addressState.trim() === "") {
      items.push({ id: "address", message: SELL.outstandingAddressState, targetId: "address-state" });
    } else {
      items.push({ id: "address", message: SELL.outstandingAddressPincode, targetId: "address-pincode" });
    }
  }

  return items;
}

/**
 * `canSave` has exactly one legitimate reason to be false that is not a
 * named, pointed-at problem: the sale is already being saved. Everything
 * else comes from `computeOutstanding`, so it cannot go out of sync with
 * what the outstanding panel shows.
 */
export function canSaveFrom(outstanding: readonly OutstandingItem[], saving: boolean): boolean {
  return !saving && outstanding.length === 0;
}
