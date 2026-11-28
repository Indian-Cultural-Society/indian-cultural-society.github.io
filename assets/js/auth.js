// ICS Cambridge — shared by the member pages (login.js, members.js).
// The settings and wording come from content/members.yaml, via the #auth-settings block.
// The Firebase SDK is loaded from Google's CDN at the exact version given there.
export const settings = JSON.parse(document.getElementById("auth-settings").textContent);

const sdk = (name) => import(`https://www.gstatic.com/firebasejs/${settings.sdk_version}/firebase-${name}.js`);

// Loads Firebase and the named parts of it ("auth", "firestore"); returns the app and those modules
export async function connect(...names) {
  const [{ initializeApp }, ...modules] = await Promise.all([sdk("app"), ...names.map(sdk)]);
  return [initializeApp(settings.config), ...modules];
}

// Firebase error codes -> the wording in content/members.yaml (login_page.errors)
const ERRORS = {
  "auth/invalid-credential": "wrong_password",
  "auth/wrong-password": "wrong_password",
  "auth/user-not-found": "wrong_password",
  "auth/invalid-email": "wrong_password",
  "auth/email-already-in-use": "email_in_use",
  "auth/weak-password": "weak_password",
  "auth/password-does-not-meet-requirements": "weak_password",
  "auth/too-many-requests": "too_many_requests",
  "auth/popup-closed-by-user": "popup_closed",
  "auth/cancelled-popup-request": "popup_closed",
};
export const errorText = (error) => {
  console.error(error);
  return settings.errors[ERRORS[error.code] || "general"];
};

// Remembered on this browser so every page's header can say "My account" without loading Firebase
// (main.js reads it). Only a hint: the members' area still asks Firebase who is signed in.
export const rememberSignedIn = (signedIn) => {
  try {
    if (signedIn) localStorage.setItem("ics-member-signed-in", "1");
    else localStorage.removeItem("ics-member-signed-in");
  } catch { /* storage blocked: the header keeps saying "Member login" */ }
};

// Shows the [data-auth-panel] called `name` inside root and hides the others
export const showPanel = (root, name) => {
  root.querySelectorAll("[data-auth-panel]").forEach((panel) => { panel.hidden = panel.dataset.authPanel !== name; });
};

// While something is being saved: the button shows `label` with a spinner, and it and `others`
// can't be pressed again. Returns a function that puts them back as they were.
export const busy = (button, label, others = []) => {
  const text = button.innerHTML;
  const locked = [button, ...others].filter((b) => !b.disabled);
  locked.forEach((b) => { b.disabled = true; });
  button.setAttribute("aria-busy", "true");
  button.textContent = label;
  return () => {
    button.innerHTML = text;
    button.removeAttribute("aria-busy");
    locked.forEach((b) => { b.disabled = false; });
  };
};

// "Welcome, {name}" + {name: "Asha"} -> "Welcome, Asha"
export const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");

export const formatDate = (timestamp) =>
  timestamp ? timestamp.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
