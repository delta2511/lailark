import type { Role } from "@lailark/shared";
import {
  RecaptchaVerifier,
  onAuthStateChanged,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
  type User as AuthUser,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { COPY, roleLabel } from "./copy";
import { auth, db } from "./firebase";
import { cleanOtp, formatIndianMobile, parseIndianMobile } from "./phone";
import { roleFromClaims } from "./session";

type Step = "loading" | "phone" | "otp" | "signedIn";

interface Session {
  readonly name: string;
  readonly role: Role;
  readonly phone: string;
}

const RECAPTCHA_ID = "recaptcha";

export function App() {
  const [step, setStep] = useState<Step>("loading");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [session, setSession] = useState<Session | null>(null);

  const confirmation = useRef<ConfirmationResult | null>(null);
  const verifier = useRef<RecaptchaVerifier | null>(null);

  const clearVerifier = useCallback(() => {
    verifier.current?.clear();
    verifier.current = null;
  }, []);

  // The claim is the gate. Force-refresh the token so a role set moments ago
  // by setRole is already in it, then let anyone without one of the three
  // roles back out with a plain message.
  useEffect(
    () =>
      onAuthStateChanged(auth, (user: AuthUser | null) => {
        if (!user) {
          setSession(null);
          setStep((current) => (current === "loading" ? "phone" : current));
          return;
        }
        void admit(user);
      }),
    [],
  );

  async function admit(user: AuthUser): Promise<void> {
    const token = await user.getIdTokenResult(true);
    const role = roleFromClaims(token.claims);
    const phoneNumber = formatIndianMobile(user.phoneNumber ?? "");

    if (!role) {
      await signOut(auth);
      confirmation.current = null;
      clearVerifier();
      setDenied(true);
      setStep("phone");
      setCode("");
      return;
    }

    setSession({ name: await nameFor(user.uid, phoneNumber), role, phone: phoneNumber });
    setDenied(false);
    setError(null);
    setStep("signedIn");
  }

  // The users document holds the name. If it is missing, or the read is
  // refused, the phone number stands in: the claim already said yes.
  async function nameFor(uid: string, fallback: string): Promise<string> {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      const name = snap.exists() ? (snap.data() as { name?: unknown }).name : undefined;
      return typeof name === "string" && name.trim() !== "" ? name : fallback;
    } catch {
      return fallback;
    }
  }

  async function sendCode(event: Event): Promise<void> {
    event.preventDefault();
    setDenied(false);
    const parsed = parseIndianMobile(phone);
    if (!parsed.ok) {
      setError(
        parsed.reason === "empty"
          ? COPY.phoneEmpty
          : parsed.reason === "notIndian"
            ? COPY.phoneNotIndian
            : COPY.phoneInvalid,
      );
      return;
    }

    setError(null);
    setBusy(true);
    try {
      if (!verifier.current) {
        verifier.current = new RecaptchaVerifier(auth, RECAPTCHA_ID, { size: "invisible" });
      }
      confirmation.current = await signInWithPhoneNumber(auth, parsed.e164, verifier.current);
      setSentTo(formatIndianMobile(parsed.e164));
      setCode("");
      setStep("otp");
    } catch {
      clearVerifier();
      setError(COPY.sendFailed);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: Event): Promise<void> {
    event.preventDefault();
    const six = cleanOtp(code);
    if (six.length !== 6) {
      setError(COPY.codeEmpty);
      return;
    }
    if (!confirmation.current) {
      setError(COPY.sendFailed);
      setStep("phone");
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await confirmation.current.confirm(six);
      clearVerifier();
      // onAuthStateChanged takes it from here.
    } catch {
      setError(COPY.codeInvalid);
    } finally {
      setBusy(false);
    }
  }

  function startOver(): void {
    confirmation.current = null;
    clearVerifier();
    setCode("");
    setError(null);
    setStep("phone");
  }

  async function leave(): Promise<void> {
    await signOut(auth);
    confirmation.current = null;
    clearVerifier();
    setPhone("");
    setCode("");
    setDenied(false);
    setError(null);
    setStep("phone");
  }

  if (step === "loading") {
    return (
      <main class="screen">
        <div id={RECAPTCHA_ID} />
      </main>
    );
  }

  if (step === "signedIn" && session) {
    return (
      <main class="screen">
        <h1 class="wordmark">{COPY.signInTitle}</h1>
        <hr class="hairline" />
        <p class="who" data-testid="signed-in">
          Signed in as {session.name}
        </p>
        <p class="role" data-testid="role">
          {roleLabel(session.role)}
        </p>
        <p class="lede">{session.phone}</p>
        <div class="spacer" />
        <button class="quiet" type="button" onClick={() => void leave()}>
          {COPY.signOut}
        </button>
        <div id={RECAPTCHA_ID} />
      </main>
    );
  }

  return (
    <main class="screen">
      <h1 class="wordmark">{COPY.signInTitle}</h1>
      <p class="lede">{COPY.signInLede}</p>

      {denied ? (
        <div class="notice" data-testid="denied">
          <p>{COPY.notAllowed}</p>
        </div>
      ) : null}

      {step === "phone" ? (
        <form onSubmit={(event) => void sendCode(event)}>
          <label for="phone">{COPY.phoneLabel}</label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={COPY.phonePlaceholder}
            value={phone}
            onInput={(event) => setPhone((event.target as HTMLInputElement).value)}
          />
          {error ? (
            <p class="error" data-testid="error">
              {error}
            </p>
          ) : null}
          <div class="hairline" />
          <button type="submit" disabled={busy}>
            {busy ? COPY.sending : COPY.sendCode}
          </button>
        </form>
      ) : (
        <form onSubmit={(event) => void verifyCode(event)}>
          <p class="lede">{COPY.codeSentTo(sentTo)}</p>
          <label for="code">{COPY.codeLabel}</label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onInput={(event) => setCode((event.target as HTMLInputElement).value)}
          />
          {error ? (
            <p class="error" data-testid="error">
              {error}
            </p>
          ) : null}
          <div class="hairline" />
          <button type="submit" disabled={busy}>
            {busy ? COPY.verifying : COPY.verify}
          </button>
          <div class="hairline" />
          <button class="quiet" type="button" onClick={startOver}>
            {COPY.useAnotherNumber}
          </button>
        </form>
      )}

      <div id={RECAPTCHA_ID} />
    </main>
  );
}
