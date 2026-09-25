"use client";

import { useEffect, useState } from "react";

import { usePathname } from "../_lib/search";
import {
  addressLines,
  formatDate,
  formatINR,
  formatMillis,
  jarWords,
  orderApiUrl,
  readOrderPayload,
  tokenFromPath,
} from "../../lib/order";
import { documentKindWords, ORDER_PAGE_COPY as COPY } from "../../lib/orderCopy";

/**
 * The private order page, `/o/<token>` (brief §5, M3.8).
 *
 * The site is a static export, so there is no per-token page to build: one
 * file is served for every `/o/...` path by a Hosting rewrite, and the token
 * is read off `window.location.pathname` here. Nothing about the order is in
 * the HTML, which is the right way round for a page that carries somebody's
 * address: the static file is the same for everybody and the private part
 * arrives from `/api/order/<token>`, uncached.
 *
 * Three states and no fourth: waiting (nothing said, the slot holds), the
 * order, or one sentence saying we could not find it. A malformed token is
 * the same sentence as a token nobody has, because the difference is not the
 * customer's business and telling them would tell a stranger something too.
 */
export default function OrderView() {
  // Derived during render, not set in an effect: a link that is not a link
  // needs no fetch and no state change, only the sentence below.
  const pathname = usePathname();
  const token = tokenFromPath(pathname);
  const url = orderApiUrl(token);
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    if (url === null) return;
    let live = true;
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        if (!live) return;
        if (res.status === 404) {
          setState({ status: "notFound" });
          return;
        }
        if (!res.ok) {
          setState({ status: "unavailable" });
          return;
        }
        const order = readOrderPayload(await res.json());
        setState(order ? { status: "ready", order } : { status: "notFound" });
      })
      .catch(() => {
        if (live) setState({ status: "unavailable" });
      });
    return () => {
      live = false;
    };
  }, [url]);

  // `""` is the server snapshot, before this has mounted: nothing is known
  // yet, so nothing is said. A real path that is not a token is the refusal.
  if (pathname !== "" && url === null) {
    return (
      <div className="order-live" aria-live="polite">
        <p className="order-note">{COPY.notFound}</p>
      </div>
    );
  }

  if (state.status === "loading") {
    return <div className="order-live" aria-live="polite" />;
  }
  if (state.status !== "ready") {
    return (
      <div className="order-live" aria-live="polite">
        <p className="order-note">
          {state.status === "notFound" ? COPY.notFound : COPY.unavailable}
        </p>
      </div>
    );
  }

  const { order } = state;
  const placed = formatMillis(order.placedOnMillis);
  const address = addressLines(order.delivery);
  const jarNumbers = order.lines.flatMap((line) => line.jarNumbers);

  return (
    <div className="order-live" aria-live="polite">
      <dl className="order-facts">
        <div>
          <dt>{COPY.labelOrder}</dt>
          <dd className="order-ref">{order.number}</dd>
        </div>
        {placed ? (
          <div>
            <dt>{COPY.labelPlaced}</dt>
            <dd>{placed}</dd>
          </div>
        ) : null}
      </dl>

      <ul className="order-lines">
        {order.lines.map((line, index) => (
          <li key={`${line.description}-${index}`}>
            {/* No description at all when we have no name for what was
                bought: the endpoint sends `""` rather than a URL slug
                (A214, M3.8 round 3), and an empty span would hold a blank
                10rem column where a name belongs. The quantity, the batch
                and the price still read straight across. */}
            {line.description === "" ? null : (
              <span className="order-line__what">{line.description}</span>
            )}
            <span className="order-line__jars">{jarWords(line.qty)}</span>
            {line.batchNo ? (
              <span className="order-line__batch">
                {COPY.labelBatch} <a href={`/batch/${line.batchNo}`}>{line.batchNo}</a>
              </span>
            ) : null}
            {line.unitPricePaise === null ? null : (
              <span className="order-figure">{formatINR(line.unitPricePaise)}</span>
            )}
          </li>
        ))}
      </ul>

      <dl className="order-total">
        {order.shippingFeePaise === null ? null : (
          <div>
            <dt>{COPY.labelShipping}</dt>
            <dd className="order-figure">{formatINR(order.shippingFeePaise)}</dd>
          </div>
        )}
        {order.totalPaise === null ? null : (
          <div className="order-total__sum">
            <dt>{COPY.labelTotal}</dt>
            <dd className="order-figure">{formatINR(order.totalPaise)}</dd>
          </div>
        )}
      </dl>

      {jarNumbers.length > 0 ? (
        <p className="order-jars">
          {COPY.labelJarNumbers} <span className="order-figure">{jarNumbers.join(", ")}</span>
        </p>
      ) : null}

      {address.length > 0 ? (
        <div className="order-address">
          <h2>{COPY.labelGoingTo}</h2>
          <address>
            {address.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </address>
        </div>
      ) : null}

      <div className="order-documents">
        <h2>{COPY.headingDocuments}</h2>
        {order.documents.length === 0 ? (
          <p className="order-note">{COPY.noDocuments}</p>
        ) : (
          <ul>
            {order.documents.map((doc) => (
              <li key={doc.number}>
                <span className="order-doc__kind">{documentKindWords(doc.kind)}</span>
                <span className="order-ref">{doc.number}</span>
                {doc.issuedOn ? <span>{formatDate(doc.issuedOn)}</span> : null}
                {doc.totalPaise === null ? null : (
                  <span className="order-figure">{formatINR(doc.totalPaise)}</span>
                )}
                {doc.url ? (
                  <a href={doc.url} rel="noopener">
                    {COPY.documentLink}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
