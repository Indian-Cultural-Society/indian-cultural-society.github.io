// ICS Cambridge — the members' area (members.html): apply for membership, see your membership, the
// notice board, the documents and who else is a member, and for the committee, approve or decline
// applications and post notices and documents.
// firebase/firestore.rules decides who may read and write each part; this page only shows what
// the rules let it read.
import { settings, connect, errorText, showPanel, fill, formatDate, rememberSignedIn, busy } from "./auth.js";

const root = document.querySelector("[data-members]");
const $ = (selector) => root.querySelector(selector);
const card = $("[data-gate]");
const status = $("[data-status]");
const adminStatus = $("[data-admin-status]");
const applyForm = $("[data-apply-form]");
const BUSY = settings.text.busy;

let toastTimer;
const say = (text, where = status) => {
  where.textContent = text || "";
  // The committee's messages float over the page, so they show wherever you are, then go
  if (where === adminStatus) {
    clearTimeout(toastTimer);
    if (text) toastTimer = setTimeout(() => { where.textContent = ""; }, 8000);
  }
};

// The card with the sign-in and application steps; a member has none to show, so it goes away
const showStep = (name) => {
  showPanel(card, name);
  card.hidden = name === "none";
};

// Any Google Drive address -> the one that opens it read-only, even for someone allowed to edit it.
// Returns { url, kind }, or null if it isn't a Drive document. Google's own sharing settings decide who may open it.
const driveDocument = (text) => {
  let address;
  try { address = new URL(text.trim()); } catch { return null; }
  if (address.protocol !== "https:") return null;
  if (address.hostname === "docs.google.com") {
    const [, kind, id] = address.pathname.match(/^\/(document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/([\w-]+)/) || [];
    if (!kind) return null;
    // "Published to the web" (/d/e/…) is read-only already, and has no /preview
    if (id === "e") return { url: address.href, kind };
    return { url: `https://docs.google.com/${kind}/d/${id}/preview`, kind };
  }
  if (address.hostname === "drive.google.com") {
    const file = address.pathname.match(/^\/file\/(?:u\/\d+\/)?d\/([\w-]+)/)?.[1];
    if (file) return { url: `https://drive.google.com/file/d/${file}/view`, kind: "file" };
    const folder = address.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)/)?.[1];
    if (folder) return { url: `https://drive.google.com/drive/folders/${folder}`, kind: "folders" };
    const id = address.pathname === "/open" && address.searchParams.get("id");
    if (id) return { url: `https://drive.google.com/open?id=${encodeURIComponent(id)}`, kind: "file" };
  }
  return null;
};

// Asks firebase/members-script.gs, which checks with Firebase who is asking every time.
// Plain text because Apps Script can't answer the extra question browsers ask before sending JSON.
const askScript = async (user, request, options = {}) => {
  const reply = await fetch(settings.text.script_url, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ ...request, uid: user.uid, token: await user.getIdToken() }),
    ...options,
  });
  const answer = await reply.json();
  if (answer.error) throw new Error(answer.error);
  return answer;
};

// The application is already saved by now and the committee will see it in the Admin Area anyway,
// so the applicant never hears of a failure
const alertCommittee = (user) => {
  if (!settings.text.script_url) return;
  // keepalive: still goes if they close the page straight away
  askScript(user, { action: "alert" }, { keepalive: true }).catch((error) => console.warn(error));
};

// Opened in a new tab; anything else is saved instead, so nothing in a file can run on this site's address
const VIEWABLE = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"];

const fileSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`);

// Notice text as text, with web addresses turned into links (never HTML, whoever wrote it)
const withLinks = (text) => text.split(/(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)])/).map((part, i) => {
  if (i % 2 === 0) return document.createTextNode(part);
  const link = document.createElement("a");
  const drive = driveDocument(part);
  link.href = drive?.url || part;
  link.textContent = drive ? `${settings.text.document_kinds[drive.kind]} · ${settings.text.view_only}` : part;
  link.rel = "noopener";
  link.target = "_blank";
  return link;
});

try {
  const [app, { getAuth, onAuthStateChanged, signOut }, {
    getFirestore, doc, getDoc, setDoc, addDoc, deleteDoc, collection, getDocs, query, orderBy, limit,
    writeBatch, serverTimestamp,
  }] = await connect("auth", "firestore");
  const session = getAuth(app);
  const db = getFirestore(app);

  // ---- Your own membership. Says whether you are a member ----
  const welcome = [$("[data-member-welcome]"), $("[data-member-since-line]")];
  const showMine = async (user) => {
    const member = await getDoc(doc(db, "members", user.uid));
    if (member.exists()) {
      const m = member.data();
      $("[data-member-welcome]").textContent = fill(settings.text.welcome, { name: m.name });
      $("[data-member-since]").textContent = formatDate(m.since);
      welcome.forEach((line) => { line.hidden = false; });
      showStep("none");
      return true;
    }
    const application = await getDoc(doc(db, "applications", user.uid));
    showStep(application.exists() ? "pending" : "apply");
    return false;
  };

  // ---- Notices: members read them, the committee also deletes them ----
  const board = $("[data-board]");
  const noticeList = $("[data-notice-list]");
  const noticeTemplate = $("[data-notice-template]");

  const showNotices = async (isAdmin) => {
    const latest = await getDocs(query(collection(db, "notices"), orderBy("date", "desc"), limit(50)));
    noticeList.replaceChildren(...latest.docs.map((notice) => {
      const n = notice.data();
      const item = noticeTemplate.content.firstElementChild.cloneNode(true);
      item.querySelector('[data-field="date"]').textContent = formatDate(n.date);
      item.querySelector('[data-field="title"]').textContent = n.title;
      item.querySelector('[data-field="body"]').replaceChildren(...withLinks(n.body));
      const remove = item.querySelector("[data-delete-notice]");
      remove.hidden = !isAdmin;
      remove.addEventListener("click", () => deleteNotice(item, notice.id, n));
      return item;
    }));
    $("[data-no-notices]").hidden = !latest.empty;
  };

  // ---- Documents: the private Google Drive folder, by way of the script. Members never get a Drive link ----
  const documentList = $("[data-document-list]");
  const documentTemplate = $("[data-document-template]");
  const documentPath = $("[data-document-path]");
  const documentsLoading = $("[data-documents-loading]");
  const noDocuments = $("[data-no-documents]");
  const documentStatus = $("[data-documents] [data-panel-status]");
  const fileErrorText = (error) => settings.text.file_errors[error.message] || errorText(error);
  let latestAsked = 0;   // a slow answer about a folder they've since left is ignored

  const openFile = async (file, button) => {
    say("", documentStatus);
    const viewable = VIEWABLE.includes(file.mime);
    // Now rather than after the wait, or the browser blocks it. If it's blocked anyway, the file is saved instead.
    const tab = viewable ? window.open("", "_blank") : null;
    const done = busy(button, BUSY.opening);
    try {
      const { name, data } = await askScript(session.currentUser, { action: "file", id: file.id });
      const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: viewable ? file.mime : "application/octet-stream" }));
      if (tab) {
        tab.location = url;
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      tab?.close();
      say(fileErrorText(error), documentStatus);
    } finally {
      done();
    }
  };

  // `path` is the folders they've gone into, from the top: [{ id, name }]
  const showDocuments = async (path = []) => {
    const asked = ++latestAsked;
    say("", documentStatus);
    documentList.replaceChildren();
    noDocuments.hidden = true;
    documentPath.hidden = !path.length;
    documentPath.replaceChildren(...[{ name: settings.text.all_documents }, ...path].map((folder, i) => {
      if (i === path.length) return Object.assign(document.createElement("span"), { textContent: folder.name });
      const up = Object.assign(document.createElement("button"), { type: "button", textContent: folder.name });
      up.addEventListener("click", () => showDocuments(path.slice(0, i)));
      return up;
    }));
    if (!settings.text.script_url) {
      noDocuments.hidden = false;
      return;
    }
    documentsLoading.hidden = false;
    try {
      const { items } = await askScript(session.currentUser, { action: "list", folder: path.at(-1)?.id });
      if (asked !== latestAsked) return;
      documentList.replaceChildren(...items.map((file) => {
        const item = documentTemplate.content.firstElementChild.cloneNode(true);
        const button = item.querySelector('[data-field="link"]');
        button.dataset.kind = file.kind;
        item.querySelector('[data-field="title"]').textContent = file.name;
        const kind = settings.text.document_kinds[file.kind];
        item.querySelector('[data-field="kind"]').textContent = file.size ? `${kind} · ${fileSize(file.size)}` : kind;
        button.addEventListener("click", () => (file.kind === "folders"
          ? showDocuments([...path, { id: file.id, name: file.name }])
          : openFile(file, button)));
        return item;
      }));
      noDocuments.hidden = items.length > 0;
    } catch (error) {
      if (asked === latestAsked) say(fileErrorText(error), documentStatus);
    } finally {
      if (asked === latestAsked) documentsLoading.hidden = true;
    }
  };

  // ---- Who else is a member: names only, from directory/ (see firebase/firestore.rules) ----
  const directoryRows = $("[data-directory-rows]");
  const directoryTemplate = $("[data-directory-template]");
  const directoryFilter = $("[data-directory-filter]");

  // A box that hides the rows of a list that don't contain what's typed
  const filterBox = (input, rows, noMatch) => {
    const apply = () => {
      const words = input.value.trim().toLowerCase();
      let shown = 0;
      for (const row of rows.children) {
        row.hidden = !!words && !row.textContent.toLowerCase().includes(words);
        if (!row.hidden) shown += 1;
      }
      noMatch.hidden = !words || shown > 0;
    };
    input.addEventListener("input", apply);
    return apply;
  };
  const filterDirectory = filterBox(directoryFilter, directoryRows, $("[data-no-directory-match]"));

  const showDirectory = async () => {
    const listed = await getDocs(collection(db, "directory"));
    const names = listed.docs.map((entry) => entry.data().name)
      .sort((a, b) => a.localeCompare(b, "en-GB", { sensitivity: "base" }));
    directoryRows.replaceChildren(...names.map((name) => {
      const row = directoryTemplate.content.firstElementChild.cloneNode(true);
      row.textContent = name;
      return row;
    }));
    const count = $("[data-directory-count]");
    count.textContent = names.length;
    count.hidden = !names.length;
    directoryRows.hidden = !names.length;
    $("[data-no-directory]").hidden = names.length > 0;
    directoryFilter.closest("label").hidden = !names.length;
    filterDirectory();
  };

  // directory/ is a copy of the names in members/. Approving adds to it; this catches what the
  // Firebase console changes (a member removed or renamed) and anyone approved before it existed.
  const syncDirectory = async (everyone) => {
    const listed = await getDocs(collection(db, "directory"));
    const stale = new Map(listed.docs.map((entry) => [entry.id, entry.data().name]));
    const batch = writeBatch(db);
    let changes = 0;
    for (const member of everyone.docs) {
      const { name } = member.data();
      if (stale.get(member.id) !== name) {
        batch.set(doc(db, "directory", member.id), { name });
        changes += 1;
      }
      stale.delete(member.id);
    }
    for (const uid of stale.keys()) {
      batch.delete(doc(db, "directory", uid));
      changes += 1;
    }
    if (!changes) return;
    await batch.commit();
    await showDirectory();
  };

  // One of these failing shouldn't take the notice board down with it: the panel says so instead
  const inPanel = (panel, loading) => loading.catch((error) => {
    say(errorText(error), panel.querySelector("[data-panel-status]"));
  });

  applyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    say();
    const user = session.currentUser;
    const data = new FormData(applyForm);
    const done = busy(applyForm.querySelector("[type=submit]"), BUSY.sending);
    try {
      await setDoc(doc(db, "applications", user.uid), {
        name: data.get("name").trim(),
        email: user.email,
        phone: data.get("phone").trim(),
        household: data.get("household").trim(),
        consent: data.get("consent") === "on",
        submittedAt: serverTimestamp(),
      });
      alertCommittee(user);
      applyForm.reset();
      showStep("pending");
    } catch (error) {
      say(errorText(error));
    } finally {
      done();
    }
  });

  $("[data-withdraw]").addEventListener("click", async (e) => {
    say();
    const done = busy(e.currentTarget, BUSY.withdrawing);
    try {
      await deleteDoc(doc(db, "applications", session.currentUser.uid));
      showStep("apply");
    } catch (error) {
      say(errorText(error));
    } finally {
      done();
    }
  });

  // ---- Committee: applications waiting for approval ----
  const admin = $("[data-admin]");
  const list = $("[data-applications]");
  const template = $("[data-application-template]");

  const adminLink = $("[data-admin-link]");
  const showWaiting = () => {
    root.querySelectorAll("[data-waiting]").forEach((badge) => {
      badge.textContent = fill(settings.text.waiting, { count: list.children.length });
      badge.hidden = list.children.length === 0;
    });
  };
  $("[data-open-member-list]").addEventListener("click", () => { $("[data-member-list]").open = true; });

  const showApplications = async () => {
    const waiting = await getDocs(query(collection(db, "applications"), orderBy("submittedAt")));
    list.replaceChildren(...waiting.docs.map((application) => {
      const a = application.data();
      const item = template.content.firstElementChild.cloneNode(true);
      const field = (name, value) => { item.querySelector(`[data-field="${name}"]`).textContent = value || "—"; };
      field("name", a.name);
      field("email", a.email);
      field("phone", a.phone);
      field("household", a.household);
      field("submitted", formatDate(a.submittedAt));
      item.querySelector("[data-approve]").addEventListener("click", () => approve(item, application.id, a));
      item.querySelector("[data-reject]").addEventListener("click", () => reject(item, application.id, a));
      return item;
    }));
    $("[data-no-applications]").hidden = !waiting.empty;
    showWaiting();
  };

  // ---- Committee: everyone approved so far, by name, with a box to find someone ----
  const memberRows = $("[data-member-rows]");
  const memberTemplate = $("[data-member-template]");
  const memberFilter = $("[data-member-filter]");

  const filterMembers = filterBox(memberFilter, memberRows, $("[data-no-member-match]"));

  const showMembers = async () => {
    const everyone = await getDocs(query(collection(db, "members"), orderBy("name")));
    memberRows.replaceChildren(...everyone.docs.map((member) => {
      const m = member.data();
      const row = memberTemplate.content.firstElementChild.cloneNode(true);
      const field = (name, value) => {
        const el = row.querySelector(`[data-field="${name}"]`);
        if (value === undefined || value === null || value === "") return el.remove();
        el.textContent = el.dataset.label ? `${el.dataset.label}: ${value}` : value;
      };
      field("name", m.name);
      field("email", m.email);
      field("phone", m.phone);
      field("household", m.household);
      field("since", formatDate(m.since));
      return row;
    }));
    $("[data-member-count]").textContent = fill(settings.text.members_heading, { count: everyone.size });
    $("[data-no-members]").hidden = !everyone.empty;
    filterMembers();
    return everyone;
  };

  // A handled application shows the outcome for a moment, then leaves the list (no reload needed)
  const settle = (item, outcome, badge) => {
    item.classList.add(`is-${outcome}`);
    item.querySelector("[data-actions]").hidden = true;
    const result = item.querySelector("[data-result]");
    result.textContent = badge;
    result.hidden = false;
    setTimeout(() => {
      item.classList.add("is-leaving");
      setTimeout(() => {
        item.remove();
        $("[data-no-applications]").hidden = list.children.length > 0;
        showWaiting();
      }, 400);
    }, 1500);
  };
  const buttonsOf = (item) => [...item.querySelectorAll("[data-actions] button")];

  // Approving copies the application into members/ and removes it from applications/, in one step
  const approve = async (item, uid, a) => {
    say("", adminStatus);
    const [approveButton, ...others] = buttonsOf(item);
    const done = busy(approveButton, BUSY.approving, others);
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, "members", uid), {
        name: a.name, email: a.email, phone: a.phone || "", household: a.household || "",
        role: "member", since: serverTimestamp(), approvedBy: session.currentUser.uid,
      });
      batch.set(doc(db, "directory", uid), { name: a.name });
      batch.delete(doc(db, "applications", uid));
      await batch.commit();
      say(fill(settings.text.approved, a), adminStatus);
      settle(item, "approved", `✓ ${settings.text.approved_badge}`);
      // The new member joins the lists; if that reload fails, the approval itself still stands
      Promise.all([showMembers(), showDirectory()]).catch((error) => say(errorText(error), adminStatus));
    } catch (error) {
      done();
      say(errorText(error), adminStatus);
    }
  };

  const reject = async (item, uid, a) => {
    if (!confirm(fill(settings.text.confirm_reject, a))) return;
    say("", adminStatus);
    const [approveButton, rejectButton] = buttonsOf(item);
    const done = busy(rejectButton, BUSY.declining, [approveButton]);
    try {
      await deleteDoc(doc(db, "applications", uid));
      say(fill(settings.text.rejected, a), adminStatus);
      settle(item, "rejected", settings.text.rejected_badge);
    } catch (error) {
      done();
      say(errorText(error), adminStatus);
    }
  };

  // ---- Committee: notices ----
  const noticeForm = $("[data-notice-form]");
  noticeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    say("", adminStatus);
    const data = new FormData(noticeForm);
    const done = busy(noticeForm.querySelector("[type=submit]"), BUSY.posting);
    try {
      await addDoc(collection(db, "notices"), {
        title: data.get("title").trim(),
        body: data.get("body").trim(),
        date: serverTimestamp(),
        postedBy: session.currentUser.uid,
      });
      noticeForm.reset();
      say(settings.text.notice_posted, adminStatus);
      await showNotices(true);
    } catch (error) {
      say(errorText(error), adminStatus);
    } finally {
      done();
    }
  });

  // Asks, deletes, then fades the row out of its list
  const deleteRow = async (item, button, reference, question, deleted, list, emptyNote) => {
    if (!confirm(question)) return;
    say("", adminStatus);
    const done = busy(button, BUSY.deleting);
    try {
      await deleteDoc(reference);
      say(deleted, adminStatus);
      item.classList.add("is-leaving");
      setTimeout(() => {
        item.remove();
        emptyNote.hidden = list.children.length > 0;
      }, 400);
    } catch (error) {
      done();
      say(errorText(error), adminStatus);
    }
  };

  const deleteNotice = (item, id, n) => deleteRow(item, item.querySelector("[data-delete-notice]"),
    doc(db, "notices", id), fill(settings.text.confirm_delete_notice, n), settings.text.notice_deleted,
    noticeList, $("[data-no-notices]"));

  // ---- Who is signed in ----
  onAuthStateChanged(session, async (user) => {
    say();
    say("", adminStatus);
    rememberSignedIn(!!user);
    $("[data-account]").hidden = !user;
    admin.hidden = true;
    adminLink.hidden = true;
    board.hidden = true;
    welcome.forEach((line) => { line.hidden = true; });
    if (!user) return showStep("signed-out");
    const email = $("[data-account-email]");
    email.textContent = user.email;
    email.title = user.email;   // a long address is cut short on a wide screen
    $("[data-account-initial]").textContent = [...user.email][0].toUpperCase();
    if (!user.emailVerified) return showStep("verify");
    try {
      const isMember = await showMine(user);
      const isAdmin = (await getDoc(doc(db, "admins", user.uid))).exists();
      if (isMember || isAdmin) {
        await Promise.all([
          showNotices(isAdmin),
          inPanel($("[data-directory]"), showDirectory()),
        ]);
        board.hidden = false;
        showDocuments();   // the script can take a few seconds, so the page doesn't wait for it
      }
      if (isAdmin) {
        admin.hidden = false;
        adminLink.hidden = false;
        await showApplications();
        await inPanel($("[data-directory]"), showMembers().then(syncDirectory));
      }
    } catch (error) {
      showStep("error");
      say(errorText(error));
    }
  });

  $("[data-sign-out]").addEventListener("click", () => signOut(session).catch((error) => say(errorText(error))));
} catch (error) {
  // The SDK couldn't load (offline, blocked) or Firebase isn't set up
  showStep("error");
  say(errorText(error));
}
