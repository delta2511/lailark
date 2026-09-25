/**
 * The three answers to an approval, brief section 7.3, with no Firebase in it.
 *
 *   Yes                      the drafted message is approved as it stands
 *   Not yet, with a reason   nothing moves, nothing is sent, the card comes
 *                            back next morning
 *   Edit the message, then yes
 *
 * Who may answer: **the Owner, and nobody else.** Brief section 17.12 gives
 * "Approve half, full, photo update and broadcast" to the Owner alone, and
 * this is where that is decided. Kitchen and Viewer are refused here, on the
 * server, whatever screen they are looking at.
 *
 * What this never does: send anything. A yes writes `status` and the actor and
 * leaves `sentAt` exactly where it was, which is null. Sending is M5. That is
 * the whole of D5 and of CLAUDE.md section 3: the Owner's yes is recorded, and
 * the message waits.
 *
 * Two of the four kinds are not answered here at all. The yes on a
 * half-reached approval **is** the `Half reached -> Sourcing` row of section
 * 8.2, so it goes through `transitionBatch` and the state moves in the same
 * transaction; the yes on a full approval has had its own callable since A62.
 * Both are refused here by name rather than quietly duplicated, so there is
 * one door to each and no two ways to record the same yes.
 */

import {
  answersYesDirectly,
  APPROVAL_YES_DOOR,
  checkCustomerText,
  type ApprovalKind,
  isApprovalApproved,
  nextMorningMillis,
  ROLES,
  type Role,
} from "@lailark/shared";

import type { ApprovalView } from "../batches/store";
import type { ErrorCode, Failure } from "../batches/transitions";

/**
 * Brief 7.3's answers. "Edit then yes" is a `yes` carrying `messageText`.
 *
 * `sent` and `close` are D32's, and they are answers to a message that has
 * already been said yes to rather than to the approval itself: `sent` ticks
 * one recipient off the sending list once the Owner has sent it from his own
 * phone, and `close` puts the list away whether or not every row was ticked
 * ("the approval closes when all are ticked or the Owner closes it").
 *
 * Neither sends anything. Nothing in this repo sends anything.
 */
export const APPROVAL_ANSWERS = ["yes", "notYet", "sent", "close"] as const;
export type ApprovalAnswer = (typeof APPROVAL_ANSWERS)[number];

const MAX_MESSAGE = 1000;
const MAX_REASON = 300;

/** How each answer reads in a refusal the Owner might see. */
const ANSWER_WORDS: Readonly<Record<ApprovalAnswer, string>> = {
  yes: "yes",
  notYet: "not yet",
  sent: "sent",
  close: "close",
};

export interface AnswerApprovalRequest {
  /** The `approvals/{id}` document id. */
  readonly id: string;
  readonly answer: ApprovalAnswer;
  /** `messageText` on a yes, `reason` on a not yet. Nothing else. */
  readonly data: Readonly<Record<string, unknown>>;
}

/** What the callable is told to write. Plain values, no Firestore types. */
export interface ApprovalAnswerPlan {
  readonly id: string;
  readonly kind: string;
  readonly answer: ApprovalAnswer;
  /** Fields to merge onto `approvals/{id}`. */
  readonly patch: Readonly<Record<string, unknown>>;
  /** Fields the callable sets to the server timestamp. */
  readonly stampFields: readonly string[];
  /** `remindAt` in epoch millis on a not yet, null on a yes. */
  readonly remindAtMillis: number | null;
  /** True when the Owner had already answered and this call writes nothing. */
  readonly alreadyAnswered: boolean;
  /**
   * The kitchen photo update this yes approves (D5), or null. The callable
   * stamps `approvedBy` on it in the same transaction, so an approved update
   * and its approval can never disagree.
   */
  readonly photoUpdate: {
    readonly batchRef: string;
    readonly updateId: string;
    readonly messageText: string;
  } | null;
  /**
   * D32: the whole sending list as it should now stand, on a `sent` answer,
   * and null on every other answer. The callable turns `sentAtMillis` into
   * `Timestamp`s, because Firestore refuses a server timestamp inside an
   * array and a tick has to carry a real time.
   */
  readonly recipients?: readonly {
    readonly phone: string;
    readonly name: string;
    readonly jars: number;
    readonly sentAtMillis: number | null;
  }[] | null;
  /** When the sending list closed, on the answer that closed it. */
  readonly closedAtMillis?: number | null;
  readonly computed: Readonly<Record<string, number | string>>;
}

export type ApprovalAnswerPlanned = { readonly ok: true; readonly value: ApprovalAnswerPlan };

export interface AnswerContext {
  readonly caller: { readonly uid: string | null; readonly role: unknown };
  /** The approval as the transaction read it, or null when it is not there. */
  readonly approval: ApprovalView | null;
  readonly nowMillis: number;
}

function fail(code: ErrorCode, message: string): Failure {
  return { ok: false, code, message };
}

function invalid(message: string): Failure {
  return fail("invalid-argument", message);
}

function text(value: unknown, field: string, max: number): string | Failure {
  if (typeof value !== "string" || value.trim() === "") {
    return invalid(`${field} must be some text.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) return invalid(`${field} must be ${max} characters or fewer.`);
  return trimmed;
}

function isFailure(value: unknown): value is Failure {
  return typeof value === "object" && value !== null && (value as Failure).ok === false;
}

/** The shape check, before anything is read from Firestore. */
export function parseAnswerApprovalRequest(
  raw: unknown,
): { ok: true; value: AnswerApprovalRequest } | Failure {
  if (typeof raw !== "object" || raw === null) {
    return invalid("answerApproval needs an object with `id` and `answer`.");
  }
  const data = raw as Record<string, unknown>;

  if (typeof data.id !== "string" || data.id.trim() === "" || data.id.includes("/") || data.id.length > 200) {
    return invalid("id must be the id of one approvals document.");
  }
  if (typeof data.answer !== "string" || !(APPROVAL_ANSWERS as readonly string[]).includes(data.answer)) {
    return invalid(`answer must be one of ${APPROVAL_ANSWERS.join(", ")}.`);
  }
  const answer = data.answer as ApprovalAnswer;

  const inputs = data.data;
  if (inputs !== undefined && (typeof inputs !== "object" || inputs === null || Array.isArray(inputs))) {
    return invalid("data must be an object of the inputs this answer asks for.");
  }
  const given = (inputs as Record<string, unknown> | undefined) ?? {};

  // Each answer takes exactly one input, and a mistyped one is refused rather
  // than dropped: a "not yet" that arrived carrying `messageText` is somebody
  // who meant to say yes, and silently recording it as a deferral would lose
  // the message and the intention together.
  const allowed =
    answer === "yes"
      ? ["messageText"]
      : answer === "notYet"
        ? ["reason"]
        : answer === "sent"
          ? ["phone"]
          : [];
  const unexpected = Object.keys(given).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    return invalid(
      `Answering ${ANSWER_WORDS[answer]} asks for ${allowed.length === 0 ? "nothing" : allowed.join(", ")}, not ${unexpected
        .sort()
        .join(", ")}.`,
    );
  }

  return { ok: true, value: { id: data.id.trim(), answer, data: given } };
}

/**
 * The whole of brief 7.3 in one function: who may answer, what each answer
 * records, and what it deliberately does not touch. Nothing here reads or
 * writes anything, and nothing here sends anything.
 */
export function planApprovalAnswer(
  request: AnswerApprovalRequest,
  context: AnswerContext,
): ApprovalAnswerPlanned | Failure {
  const { caller, approval, nowMillis } = context;

  if (caller.uid === null) {
    return fail("unauthenticated", "Sign in first.");
  }
  const role =
    typeof caller.role === "string" && (ROLES as readonly string[]).includes(caller.role)
      ? (caller.role as Role)
      : null;
  if (role === null) {
    return fail("permission-denied", "This number is not on the Lailark admin list.");
  }
  // Brief 17.12, and the point of the whole collection: nothing a customer
  // sees goes out without Shefin. Kitchen and Viewer stop here.
  if (role !== "owner") {
    return fail(
      "permission-denied",
      "Only the owner answers an approval. Nothing goes to a customer without Shefin.",
    );
  }

  if (approval === null) {
    return fail("not-found", `There is no approval ${request.id}.`);
  }
  // Once M5 has sent the message there is nothing left to answer: an approval
  // with a `sentAt` is history.
  if (approval.sentAtMillis !== null) {
    return fail("failed-precondition", "That message has already gone out, so it cannot be answered again.");
  }
  if (approval.status === "dropped") {
    return fail("failed-precondition", "That approval has been dropped.");
  }

  if (request.answer === "sent") return planSent(request, approval, caller.uid, nowMillis);
  if (request.answer === "close") return planClose(approval, caller.uid);
  return request.answer === "yes"
    ? planYes(request, approval, caller.uid)
    : planNotYet(request, approval, caller.uid, nowMillis);
}

/**
 * D32: one row of the sending list ticked, because the Owner has just sent
 * that message from his own phone.
 *
 * What it records is a fact about the past ("this went"), so it is written
 * once and never moved: a second tap on the same row writes nothing, and the
 * time the first tick recorded stands. When the tick is the last untied row
 * the list closes itself, which is what makes "the approval closes when all
 * are ticked" true without anybody having to notice.
 *
 * It can only ever tick a row that is already on the list. There is no way in
 * to add a recipient, which is the point: the list is who the batch's paid
 * customers were when the Owner said yes, not a box anybody can type a phone
 * number into.
 */
function planSent(
  request: AnswerApprovalRequest,
  approval: ApprovalView,
  uid: string,
  nowMillis: number,
): ApprovalAnswerPlanned | Failure {
  if (!isApprovalApproved(approval.status)) {
    return fail(
      "failed-precondition",
      "Say yes to this message first. Nothing goes to a customer before that.",
    );
  }
  const recipients = approval.recipients;
  if (recipients === null || recipients.length === 0) {
    return fail("failed-precondition", "That approval has nobody to send to.");
  }
  const phone = text(request.data.phone, "phone", 20);
  if (isFailure(phone)) return phone;

  const index = recipients.findIndex((row) => row.phone === phone);
  if (index === -1) {
    return fail("not-found", `${phone} is not on this message's list.`);
  }
  if (recipients[index]?.sentAtMillis !== null) {
    return {
      ok: true,
      value: {
        id: approval.id,
        kind: approval.kind,
        answer: "sent",
        patch: {},
        stampFields: [],
        remindAtMillis: null,
        alreadyAnswered: true,
        photoUpdate: null,
        computed: { status: approval.status, phone },
      },
    };
  }

  // The whole array is rewritten, because Firestore cannot set one element of
  // one, and a server timestamp cannot live inside an array at all. It is
  // rebuilt from the approval as this transaction read it, so two ticks
  // racing are retried against each other rather than overwriting.
  const next = recipients.map((row, i) => ({
    phone: row.phone,
    name: row.name,
    jars: row.jars,
    sentAtMillis: i === index ? nowMillis : row.sentAtMillis,
  }));
  const remaining = next.filter((row) => row.sentAtMillis === null).length;

  return {
    ok: true,
    value: {
      id: approval.id,
      kind: approval.kind,
      answer: "sent",
      patch: { answeredBy: uid },
      stampFields: ["updatedAt"],
      remindAtMillis: null,
      alreadyAnswered: false,
      photoUpdate: null,
      recipients: next,
      // "The approval closes when all are ticked or the Owner closes it"
      // (D32). The last tick is the one that closes it, so nobody has to.
      closedAtMillis: remaining === 0 ? nowMillis : null,
      computed: { status: approval.status, phone, remaining },
    },
  };
}

/**
 * D32's other ending: the Owner closes the list himself, ticked or not. A
 * customer who cannot be reached on WhatsApp is not a reason for a card to
 * sit in Today for the life of the batch.
 */
function planClose(approval: ApprovalView, uid: string): ApprovalAnswerPlanned | Failure {
  if (!isApprovalApproved(approval.status)) {
    return fail("failed-precondition", "There is nothing to close until you have said yes.");
  }
  if (approval.closedAtMillis !== null) {
    return {
      ok: true,
      value: {
        id: approval.id,
        kind: approval.kind,
        answer: "close",
        patch: {},
        stampFields: [],
        remindAtMillis: null,
        alreadyAnswered: true,
        photoUpdate: null,
        computed: { status: approval.status },
      },
    };
  }
  return {
    ok: true,
    value: {
      id: approval.id,
      kind: approval.kind,
      answer: "close",
      patch: { answeredBy: uid },
      // `closedAt`, never `sentAt`: `sentAt` says a machine sent the message,
      // and no machine here sends anything (D32, D5).
      stampFields: ["closedAt", "updatedAt"],
      remindAtMillis: null,
      alreadyAnswered: false,
      photoUpdate: null,
      computed: { status: approval.status },
    },
  };
}

/**
 * Yes, and "edit then yes", which is the same answer carrying the Owner's own
 * wording. The approval records which of the two it was: `approved` when the
 * draft stood as it was, `edited` when he rewrote it, and `draft` is always
 * the text that was actually approved, so what M5 sends is what he read.
 */
function planYes(
  request: AnswerApprovalRequest,
  approval: ApprovalView,
  uid: string,
): ApprovalAnswerPlanned | Failure {
  if (!answersYesDirectly(approval.kind)) {
    const door = APPROVAL_YES_DOOR[approval.kind as ApprovalKind];
    return fail(
      "failed-precondition",
      door === undefined
        ? `An approval of kind ${approval.kind} has no yes to give.`
        : `Saying yes to ${approval.kind === "halfReached" ? "a half-reached batch" : "a full batch"} moves the batch, so it goes through ${door}, not here.`,
    );
  }

  // A second tap writes nothing at all, so the first yes is the one that
  // stands and the recorded time cannot move.
  if (isApprovalApproved(approval.status)) {
    return {
      ok: true,
      value: {
        id: approval.id,
        kind: approval.kind,
        answer: "yes",
        patch: {},
        stampFields: [],
        remindAtMillis: null,
        alreadyAnswered: true,
        photoUpdate: null,
        computed: { status: approval.status },
      },
    };
  }

  let edited: string | null = null;
  if (request.data.messageText !== undefined && request.data.messageText !== null) {
    const parsed = text(request.data.messageText, "messageText", MAX_MESSAGE);
    if (isFailure(parsed)) return parsed;
    // CLAUDE.md section 3: no long dashes in anything a customer reads. The
    // same gate the two transition callables use, so the rule cannot hold on
    // one door and not the others.
    const check = checkCustomerText(parsed);
    if (!check.ok) return invalid(check.message);
    edited = parsed;
  }

  const draft = edited ?? approval.draft;
  // An "edit" that changed nothing is not an edit. Comparing the text rather
  // than merely noting that a `messageText` arrived keeps the record honest:
  // re-submitting the same sentence with a stray space is a yes.
  const status = edited === null || edited === approval.draft ? "approved" : "edited";

  const photoUpdate =
    approval.kind === "photoUpdate" && approval.batchRef !== null && approval.updateId !== null
      ? { batchRef: approval.batchRef, updateId: approval.updateId, messageText: draft }
      : null;

  return {
    ok: true,
    value: {
      id: approval.id,
      kind: approval.kind,
      answer: "yes",
      patch: {
        status,
        draft,
        answeredBy: uid,
        // The deferral is spent: this approval is answered, not waiting for a
        // morning. `reason` is left where it is, as the record of the wait.
        remindAt: null,
      },
      // `sentAt` is not in this list, and never will be here. M5 sends.
      stampFields: ["at", "updatedAt"],
      remindAtMillis: null,
      alreadyAnswered: false,
      photoUpdate,
      computed: { status },
    },
  };
}

/**
 * "Not yet, with a reason" (brief 7.3): the batch stays exactly where it is,
 * customers hear nothing, and the card comes back next morning. The reason is
 * required, because a deferral nobody wrote a reason for is one nobody can
 * answer tomorrow.
 *
 * The production clock is deliberately left running. A "not yet" is the Owner
 * saying he is not ready, and the 5-day commitment to the kitchen (brief 7.3)
 * does not pause because he is not ready: he should see it counting.
 */
function planNotYet(
  request: AnswerApprovalRequest,
  approval: ApprovalView,
  uid: string,
  nowMillis: number,
): ApprovalAnswerPlanned | Failure {
  if (isApprovalApproved(approval.status)) {
    return fail(
      "failed-precondition",
      "You have already said yes to this one, so it cannot be put off.",
    );
  }

  const reason = text(request.data.reason, "reason", MAX_REASON);
  if (isFailure(reason)) return reason;

  const remindAtMillis = nextMorningMillis(nowMillis);

  return {
    ok: true,
    value: {
      id: approval.id,
      kind: approval.kind,
      answer: "notYet",
      patch: {
        status: "notYet",
        reason,
        answeredBy: uid,
      },
      stampFields: ["at", "updatedAt"],
      remindAtMillis,
      alreadyAnswered: false,
      photoUpdate: null,
      computed: { status: "notYet", reason, remindAtMillis },
    },
  };
}
