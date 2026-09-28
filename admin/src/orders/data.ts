/**
 * The Firestore side of the Orders screen (brief §17.5, M3.9).
 *
 * Read only, on purpose (see the task's scope note): every order is created
 * and changed by a callable (`firestore.rules`' `orders/{orderId}` block
 * says so in as many words), so this file has no write path at all, unlike
 * `batches/data.ts` or `products/data.ts` which both hold direct writes for
 * the fields their rules give a client. Packing, courier booking and refund
 * recording each add their own callable in a later milestone; this screen
 * only has to show what already happened.
 *
 * `documents` (`firestore.rules`' money block) is read separately from the
 * order itself because its rule is `seesMoney()` (Owner and Viewer), not
 * `isAdmin()` (all three): Kitchen can open an order and see its `payment`
 * field, which lives on the order document, but not the bill's own PDF
 * metadata. `useDocumentsForOrder` reports that as `denied` the same way
 * every other gated read in this app does, and the screen renders an honest
 * line rather than an empty list a Kitchen reader might mistake for "no
 * bill yet".
 */
import type { DocumentRecord, Order, Refund, Shipment } from "@lailark/shared";
import { collection, doc, onSnapshot, orderBy, query, where, type Unsubscribe } from "firebase/firestore";
import { useEffect, useState } from "preact/hooks";

import { db } from "../firebase";
import type { Live } from "../products/data";

export const ORDERS_COLLECTION = "orders";
export const DOCUMENTS_COLLECTION = "documents";
export const SHIPMENTS_COLLECTION = "shipments";
export const REFUNDS_COLLECTION = "refunds";

/** A document as the screen holds it: its id, and the fields it carries. */
export type OrderDoc = Partial<Order> & { readonly id: string };
export type DocumentDoc = Partial<DocumentRecord> & { readonly id: string };
export type ShipmentDoc = Partial<Shipment> & { readonly id: string };
export type RefundDoc = Partial<Refund> & { readonly id: string };

/** Every order, newest first: the same "newest first" rule brief 17.4 gives batches. */
export function useOrders(): Live<OrderDoc> {
  const [state, setState] = useState<Live<OrderDoc>>({ items: [], loading: true, denied: false });

  useEffect(() => {
    const q = query(collection(db, ORDERS_COLLECTION), orderBy("createdAt", "desc"));
    return onSnapshot(
      q,
      (snap) => setState({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as OrderDoc), loading: false, denied: false }),
      () => setState({ items: [], loading: false, denied: true }),
    );
  }, []);

  return state;
}

/**
 * One order by id, read straight off the document rather than filtered out
 * of the list. Named `SingleOrderRead` rather than `OrderState`, which is
 * already `@lailark/shared`'s name for the order lifecycle state
 * (`held`, `packed`, ...) that this screen shows all over the place.
 */
export interface SingleOrderRead {
  readonly order: OrderDoc | null;
  readonly loading: boolean;
  readonly denied: boolean;
  /** True once the read has answered and there is genuinely no such order. */
  readonly notFound: boolean;
}

export function useOrder(orderId: string | null): SingleOrderRead {
  const [state, setState] = useState<SingleOrderRead>({
    order: null,
    loading: orderId !== null,
    denied: false,
    notFound: false,
  });

  useEffect(() => {
    if (orderId === null) {
      setState({ order: null, loading: false, denied: false, notFound: false });
      return undefined;
    }
    setState({ order: null, loading: true, denied: false, notFound: false });
    const stop: Unsubscribe = onSnapshot(
      doc(db, ORDERS_COLLECTION, orderId),
      (snap) => {
        if (!snap.exists()) {
          setState({ order: null, loading: false, denied: false, notFound: true });
          return;
        }
        setState({
          order: { id: snap.id, ...snap.data() } as OrderDoc,
          loading: false,
          denied: false,
          notFound: false,
        });
      },
      () => setState({ order: null, loading: false, denied: true, notFound: false }),
    );
    return stop;
  }, [orderId]);

  return state;
}

/**
 * Every `documents/{id}` for one order (a bill, a receipt, and later a
 * refund note or credit note). `seesMoney()`-gated, so this comes back
 * `denied` for Kitchen: the caller shows that as "not visible to your role"
 * rather than "none yet", which is a different fact.
 */
export function useDocumentsForOrder(orderId: string | null): Live<DocumentDoc> {
  const [state, setState] = useState<Live<DocumentDoc>>({
    items: [],
    loading: orderId !== null,
    denied: false,
  });

  useEffect(() => {
    if (orderId === null) {
      setState({ items: [], loading: false, denied: false });
      return undefined;
    }
    setState({ items: [], loading: true, denied: false });
    const q = query(collection(db, DOCUMENTS_COLLECTION), where("orderId", "==", orderId));
    return onSnapshot(
      q,
      (snap) => setState({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as DocumentDoc), loading: false, denied: false }),
      () => setState({ items: [], loading: false, denied: true }),
    );
  }, [orderId]);

  return state;
}

/**
 * Every `documents/{id}` there is, for the list screen's search box: brief
 * §17.5 asks to search "by name, number, bill number, pincode", and a bill
 * number is only ever on `documents`, never on the order itself. `denied`
 * for Kitchen exactly as {@link useDocumentsForOrder} is, and the search
 * (`search.ts`) treats a denied or empty read the same way: it simply never
 * matches on a bill number, which is correct for a role that cannot see one.
 */
export function useAllDocuments(): Live<DocumentDoc> {
  const [state, setState] = useState<Live<DocumentDoc>>({ items: [], loading: true, denied: false });

  useEffect(() => {
    return onSnapshot(
      collection(db, DOCUMENTS_COLLECTION),
      (snap) => setState({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as DocumentDoc), loading: false, denied: false }),
      () => setState({ items: [], loading: false, denied: true }),
    );
  }, []);

  return state;
}

/**
 * M4.1's `shipments/{orderId}` (one per order, `functions/src/shipments/
 * store.ts`'s `shipmentIdFor`): the packing cost, courier, consignment
 * number and delivery stamp `packOrder`/`shipOrder`/`deliverOrder` write.
 * `isAdmin()`-readable, so every role sees it; nothing here writes it, the
 * same read-only shape `useOrder` already has.
 */
export interface SingleShipmentRead {
  readonly shipment: ShipmentDoc | null;
  readonly loading: boolean;
  readonly denied: boolean;
}

export function useShipment(orderId: string | null): SingleShipmentRead {
  const [state, setState] = useState<SingleShipmentRead>({
    shipment: null,
    loading: orderId !== null,
    denied: false,
  });

  useEffect(() => {
    if (orderId === null) {
      setState({ shipment: null, loading: false, denied: false });
      return undefined;
    }
    setState({ shipment: null, loading: true, denied: false });
    const stop: Unsubscribe = onSnapshot(
      doc(db, SHIPMENTS_COLLECTION, orderId),
      (snap) => {
        setState({
          shipment: snap.exists() ? ({ id: snap.id, ...snap.data() } as ShipmentDoc) : null,
          loading: false,
          denied: false,
        });
      },
      () => setState({ shipment: null, loading: false, denied: true }),
    );
    return stop;
  }, [orderId]);

  return state;
}

/**
 * Every `refunds/{id}` recorded against one order (M4.5, brief §12.3).
 *
 * `seesMoney()`-gated like `documents`, so this comes back `denied` for
 * Kitchen. The refund panel is Owner-only anyway, so the screen never renders
 * this for a role that cannot read it; the `denied` branch is kept because the
 * rule, not the screen, is what decides.
 *
 * Nothing here writes: `refunds` takes no client write in any role
 * (CLAUDE.md §3), and `refundActions.ts` is the only door.
 */
export function useRefundsForOrder(orderId: string | null): Live<RefundDoc> {
  const [state, setState] = useState<Live<RefundDoc>>({
    items: [],
    loading: orderId !== null,
    denied: false,
  });

  useEffect(() => {
    if (orderId === null) {
      setState({ items: [], loading: false, denied: false });
      return undefined;
    }
    setState({ items: [], loading: true, denied: false });
    const q = query(collection(db, REFUNDS_COLLECTION), where("orderId", "==", orderId));
    return onSnapshot(
      q,
      (snap) =>
        setState({
          items: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as RefundDoc),
          loading: false,
          denied: false,
        }),
      () => setState({ items: [], loading: false, denied: true }),
    );
  }, [orderId]);

  return state;
}

/**
 * `settings/messages` (D24): the Owner's own wording for the five customer
 * messages, read here only so the bill draft (`billMessage.ts`) can prefer it
 * over the fallback in `DEFAULT_CUSTOMER_MESSAGES`, the same way brief §8.2's
 * batch messages already do. `null` while it is loading or has never been
 * written, which `customerMessage` already treats as "use the draft".
 */
export function useMessageOverrides(): Partial<Record<string, unknown>> | null {
  const [overrides, setOverrides] = useState<Partial<Record<string, unknown>> | null>(null);

  useEffect(() => {
    return onSnapshot(
      doc(db, "settings", "messages"),
      (snap) => setOverrides(snap.exists() ? (snap.data() as Partial<Record<string, unknown>>) : null),
      () => setOverrides(null),
    );
  }, []);

  return overrides;
}

/** Groups a flat `documents` read by the order it belongs to, for the search box. */
export function documentsByOrderId(documents: readonly DocumentDoc[]): ReadonlyMap<string, readonly DocumentDoc[]> {
  const byOrder = new Map<string, DocumentDoc[]>();
  for (const document of documents) {
    if (!document.orderId) continue;
    const list = byOrder.get(document.orderId) ?? [];
    list.push(document);
    byOrder.set(document.orderId, list);
  }
  return byOrder;
}
