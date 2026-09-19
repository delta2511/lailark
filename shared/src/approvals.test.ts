/**
 * The approvals vocabulary (M2.5): what is waiting on the Owner right now,
 * when a "not yet" card comes back, and which door each kind's yes goes
 * through.
 */

import { describe, expect, it } from "vitest";

import {
  APPROVAL_YES_DOOR,
  answersYesDirectly,
  approvalHasMessage,
  clockDaysForKind,
  FULL_CLOCK_DAYS,
  HALF_CLOCK_DAYS,
  isApprovalApproved,
  isApprovalWaitingOnOwner,
  NOT_YET_REMIND_HOUR_KOLKATA,
  nextMorningMillis,
} from "./approvals.js";
import { KOLKATA_UTC_OFFSET_MINUTES } from "./dates.js";

/** An instant from a wall-clock time in Asia/Kolkata. */
function kolkata(iso: string): number {
  return Date.parse(`${iso}Z`) - KOLKATA_UTC_OFFSET_MINUTES * 60 * 1000;
}

describe("next morning", () => {
  it("is 7 am Kolkata the following day for an evening answer", () => {
    const at = kolkata("2026-09-19T21:10:00.000");
    expect(nextMorningMillis(at)).toBe(kolkata("2026-09-20T07:00:00.000"));
  });

  it("is 7 am the same day for an answer given in the small hours", () => {
    const at = kolkata("2026-09-20T02:30:00.000");
    expect(nextMorningMillis(at)).toBe(kolkata("2026-09-20T07:00:00.000"));
  });

  it("does not land on the same instant it was asked at 7 am exactly", () => {
    const at = kolkata("2026-09-20T07:00:00.000");
    expect(nextMorningMillis(at)).toBe(kolkata("2026-09-21T07:00:00.000"));
  });

  it("uses the hour the constant names", () => {
    expect(NOT_YET_REMIND_HOUR_KOLKATA).toBe(7);
  });
});

describe("what is waiting on the Owner", () => {
  const now = kolkata("2026-09-20T09:00:00.000");

  it("counts a waiting approval", () => {
    expect(isApprovalWaitingOnOwner({ status: "waiting" }, now)).toBe(true);
  });

  it("hides a not-yet until its morning comes round", () => {
    const later = kolkata("2026-09-21T07:00:00.000");
    expect(isApprovalWaitingOnOwner({ status: "notYet", remindAtMillis: later }, now)).toBe(false);
  });

  it("brings a not-yet back once its morning has passed", () => {
    const earlier = kolkata("2026-09-20T07:00:00.000");
    expect(isApprovalWaitingOnOwner({ status: "notYet", remindAtMillis: earlier }, now)).toBe(true);
  });

  it("shows a not-yet with no reminder at all rather than losing it", () => {
    expect(isApprovalWaitingOnOwner({ status: "notYet", remindAtMillis: null }, now)).toBe(true);
  });

  it("never counts an answered approval", () => {
    for (const status of ["approved", "edited", "dropped"]) {
      expect(isApprovalWaitingOnOwner({ status }, now)).toBe(false);
    }
  });
});

describe("answered", () => {
  it("is approved or edited, and nothing else", () => {
    expect(isApprovalApproved("approved")).toBe(true);
    expect(isApprovalApproved("edited")).toBe(true);
    expect(isApprovalApproved("waiting")).toBe(false);
    expect(isApprovalApproved("notYet")).toBe(false);
    expect(isApprovalApproved(undefined)).toBe(false);
  });
});

describe("a message to edit", () => {
  it("is a non-empty string, and nothing else", () => {
    expect(approvalHasMessage("The batch is full.")).toBe(true);
    expect(approvalHasMessage("   ")).toBe(false);
    expect(approvalHasMessage("")).toBe(false);
    expect(approvalHasMessage(null)).toBe(false);
    expect(approvalHasMessage(42)).toBe(false);
  });
});

describe("which door a yes goes through", () => {
  it("sends the half-reached yes through the transition table, not a second door", () => {
    expect(APPROVAL_YES_DOOR.halfReached).toBe("transitionBatch");
    expect(answersYesDirectly("halfReached")).toBe(false);
  });

  it("sends the full yes through its own callable (A62)", () => {
    expect(APPROVAL_YES_DOOR.full).toBe("approveBatchFull");
    expect(answersYesDirectly("full")).toBe(false);
  });

  it("answers a broadcast and a photo update directly", () => {
    expect(answersYesDirectly("broadcast")).toBe(true);
    expect(answersYesDirectly("photoUpdate")).toBe(true);
  });

  it("treats an unknown kind as not directly answerable", () => {
    expect(answersYesDirectly("somethingElse")).toBe(false);
  });
});

describe("the clocks", () => {
  it("are five days at half and three once full (brief 7.3, 8.2)", () => {
    expect(HALF_CLOCK_DAYS).toBe(5);
    expect(FULL_CLOCK_DAYS).toBe(3);
    expect(clockDaysForKind("halfReached")).toBe(5);
    expect(clockDaysForKind("full")).toBe(3);
    expect(clockDaysForKind("broadcast")).toBe(null);
  });
});
