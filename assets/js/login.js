// ICS Cambridge — member sign-in with Firebase Authentication (login.html).
import { settings, connect, errorText, showPanel, fill, rememberSignedIn } from "./auth.js";

const root = document.querySelector("[data-auth]");
const $ = (selector) => root.querySelector(selector);
const status = $("[data-auth-status]");
const form = $("[data-auth-form]");
const say = (text) => { status.textContent = text || ""; };
const fail = (error) => say(errorText(error));

try {
  const [app, {
    getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut,
    createUserWithEmailAndPassword, signInWithEmailAndPassword,
    sendEmailVerification, sendPasswordResetEmail,
  }] = await connect("auth");
  const session = getAuth(app);
  // The link in the verification email brings people back to this page
  const returnHere = { url: location.href.split(/[?#]/)[0] };
  // Set when someone signs in here, so they go straight on to the members' area
  let signingIn = false;

  const render = (user) => {
    if (!user) return showPanel(root, "signed-out");
    if (!user.emailVerified) return showPanel(root, "verify");
    if (signingIn) return location.assign("members.html");
    $("[data-auth-signed-in-text]").textContent = fill(settings.text.signed_in, { email: user.email });
    showPanel(root, "signed-in");
  };
  onAuthStateChanged(session, (user) => { say(); rememberSignedIn(!!user); render(user); });

  // After clicking the link in the email in another tab, coming back here notices it
  document.addEventListener("visibilitychange", async () => {
    const user = session.currentUser;
    if (document.visibilityState !== "visible" || !user || user.emailVerified) return;
    await user.reload();
    signingIn = true;
    render(session.currentUser);
  });

  // Popup, not redirect: redirect sign-in breaks in browsers that block third-party storage
  // when the site isn't on Firebase Hosting, and this one is on GitHub Pages.
  $("[data-auth-google]").addEventListener("click", () => {
    say();
    signingIn = true;
    signInWithPopup(session, new GoogleAuthProvider()).catch(fail);
  });

  const credentials = () => {
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    if (!form.elements.email.checkValidity()) { form.elements.email.reportValidity(); return null; }
    return { email, password };
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    say();
    const c = credentials();
    if (!c) return;
    signingIn = true;
    signInWithEmailAndPassword(session, c.email, c.password).catch(fail);
  });

  $("[data-auth-register]").addEventListener("click", async () => {
    say();
    const c = credentials();
    if (!c) return;
    if (c.password.length < 8) return say(settings.errors.weak_password);
    try {
      const { user } = await createUserWithEmailAndPassword(session, c.email, c.password);
      await sendEmailVerification(user, returnHere);
    } catch (error) {
      fail(error);
    }
  });

  $("[data-auth-forgot]").addEventListener("click", async () => {
    say();
    const email = form.elements.email;
    if (!email.value.trim() || !email.checkValidity()) { email.focus(); email.reportValidity(); return; }
    try {
      await sendPasswordResetEmail(session, email.value.trim(), returnHere);
      say(settings.text.reset_sent);
    } catch (error) {
      // Say the same whether or not there is an account, so the form can't be used to find members
      if (error.code === "auth/too-many-requests") fail(error); else say(settings.text.reset_sent);
    }
  });

  $("[data-auth-resend]").addEventListener("click", async () => {
    try {
      await sendEmailVerification(session.currentUser, returnHere);
      say(settings.text.resent);
    } catch (error) {
      fail(error);
    }
  });

  root.querySelectorAll("[data-auth-sign-out]").forEach((button) => {
    button.addEventListener("click", () => signOut(session).catch(fail));
  });
} catch (error) {
  // The SDK couldn't load (offline, blocked) or Firebase isn't set up
  showPanel(root, "none");
  fail(error);
}
