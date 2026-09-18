import {
  RecaptchaVerifier,
  onAuthStateChanged,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
  type User as AuthUser,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import type { JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { COPY } from "./copy";
import { auth, db } from "./firebase";
import { cleanOtp, formatIndianMobile, parseIndianMobile } from "./phone";
import {
  RECAPTCHA_HOST_ID,
  clearRecaptchaArtifacts,
  resetRecaptchaWidget,
} from "./recaptcha";
import { navigate } from "./router";
import { resolveDisplayName, roleFromClaims, type Session } from "./session";
import { Shell } from "./shell/Shell";

type Step = "loading" | "phone" | "otp" | "signedIn";

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
  const widgetId = useRef<number | null>(null);
  // The element the widget is actually bound to: a fresh child of the host,
  // made per verifier. grecaptcha refuses to render twice into one element
  // ("reCAPTCHA has already been rendered in this element"), so the host is
  // permanent and the anchor inside it is disposable.
  const anchor = useRef<HTMLDivElement | null>(null);

  /**
   * Tears the widget down completely (M1.12). Every step is guarded: a throw
   * from any one of them must not skip the ones after it, or the page is left
   * with an invisible reCAPTCHA overlay across it and nothing can be tapped.
   */
  const clearVerifier = useCallback(() => {
    resetRecaptchaWidget(window, widgetId.current);
    try {
      verifier.current?.clear();
    } catch {
      // clear() throws auth/internal-error if the instance is already
      // destroyed. Either way this verifier is finished with.
    }
    verifier.current = null;
    widgetId.current = null;
    anchor.current?.remove();
    anchor.current = null;
    clearRecaptchaArtifacts(document);
  }, []);

  /**
   * M1.12. The sign-out bug was silent: nothing was logged, the screen simply
   * stopped answering. Anything that escapes a handler from here on says so in
   * the console, on a phone with remote inspection as much as on a laptop.
   */
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent): void => {
      console.error("[lailark] unhandled rejection", event.reason);
    };
    const onError = (event: ErrorEvent): void => {
      console.error("[lailark] uncaught error", event.error ?? event.message);
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
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
      try {
        await signOut(auth);
      } finally {
        // Same order as leave(): the screen is put right first, so nothing
        // below can leave this number stuck on a half-reset page (M1.12).
        setDenied(true);
        setCode("");
        setError(null);
        setBusy(false);
        setStep("phone");

        confirmation.current = null;
        clearVerifier();
      }
      return;
    }

    const name = await nameFor(user.uid, user.displayName, phoneNumber);

    // Leaving the sign-in screen for the Shell unmounts everything below, so
    // the widget goes before the screen does, not after (M1.12).
    confirmation.current = null;
    clearVerifier();

    setSession({ name, role, phone: phoneNumber });
    setDenied(false);
    setError(null);
    setStep("signedIn");
  }

  // The users document holds the name. If it is missing, has no name, or the
  // read is refused, the Auth user's displayName stands in, then the phone
  // number: the claim already said yes.
  async function nameFor(uid: string, authDisplayName: string | null, fallback: string): Promise<string> {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      const name = snap.exists() ? (snap.data() as { name?: unknown }).name : undefined;
      return resolveDisplayName(name, authDisplayName, fallback);
    } catch {
      return resolveDisplayName(undefined, authDisplayName, fallback);
    }
  }

  /**
   * A new element inside the permanent host for the widget to bind to. The
   * host outlives every screen, so nothing is ever unmounted out from under a
   * live widget (M1.12).
   */
  function freshAnchor(): HTMLDivElement {
    anchor.current?.remove();
    const host = document.getElementById(RECAPTCHA_HOST_ID);
    const next = document.createElement("div");
    (host ?? document.body).append(next);
    anchor.current = next;
    return next;
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
        verifier.current = new RecaptchaVerifier(auth, freshAnchor(), { size: "invisible" });
        // render() is what signInWithPhoneNumber would do anyway; doing it
        // here hands us the widget id, which is what lets clearVerifier ask
        // grecaptcha to reset (and so hide) the widget later.
        widgetId.current = await verifier.current.render();
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

  /**
   * Sign out. Whatever happens to the network call, the sign-in screen has to
   * come back clean: nothing typed, nothing pending, nothing busy, and no
   * reCAPTCHA left over the page (M1.12).
   */
  async function leave(): Promise<void> {
    try {
      await signOut(auth);
    } finally {
      // The screen is put right first, so no cleanup below it can ever leave
      // the app on a half-reset sign-in page.
      setSession(null);
      setPhone("");
      setCode("");
      setSentTo("");
      setDenied(false);
      setError(null);
      setBusy(false);
      setStep("phone");

      // Back to the top of the app. Otherwise the URL is still the Settings
      // page the sign out was tapped on, and the next person to sign in lands
      // straight in Settings instead of Today.
      navigate("/");

      confirmation.current = null;
      clearVerifier();
    }
  }

  function signInScreen(): JSX.Element {
    return (
      <main class="screen">
        <h1 class="wordmark">{COPY.signInTitle}</h1>
        <p class="lede">{COPY.signInLede}</p>

        {denied ? (
          <div class="notice" data-testid="denied">
            <p>{COPY.notAllowed}</p>
          </div>
        ) : null}

        {step === "otp" ? (
          <form key="otp" onSubmit={(event) => void verifyCode(event)}>
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
        ) : (
          <form key="phone" onSubmit={(event) => void sendCode(event)}>
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
        )}
      </main>
    );
  }

  /**
   * M1.12, and the reason the phone box went dead after a sign-out.
   *
   * `signOut` notifies onAuthStateChanged before its promise resolves, so for
   * one render `step` is still "signedIn" while `session` has already gone.
   * That render used to fall through to the sign-in screen, and the sign-in
   * screen used to pick its form with `step === "phone"`, so it drew the code
   * form. When `leave()` then set the step, Preact diffed the code form into
   * the phone form over the same DOM nodes and wrote maxLength 6 -> undefined,
   * which lands in the DOM as `maxlength="0"`: a box that focuses, highlights
   * and accepts no characters at all until the page is reloaded.
   *
   * So "signedIn" without a session shows nothing rather than a form, the
   * sign-in screen asks for "otp" rather than "not phone", and the two forms
   * carry keys so Preact can never reuse one's nodes for the other.
   */
  function screen(): JSX.Element {
    if (step === "signedIn") {
      return session ? (
        <Shell session={session} onSignOut={() => void leave()} />
      ) : (
        <main class="screen" />
      );
    }

    if (step === "loading") return <main class="screen" />;

    return signInScreen();
  }

  // The reCAPTCHA host is rendered once, here, outside every branch above, and
  // is never unmounted (M1.12). An invisible widget bound to a node that goes
  // away leaves a full-screen challenge container on `document.body` that
  // nothing can hide again, and it swallows every tap on the page beneath it.
  return (
    <>
      {screen()}
      <div id={RECAPTCHA_HOST_ID} class="recaptcha-host" />
    </>
  );
}
