// ICS Cambridge — design v2. Progressive enhancements; the site works without JS.
(() => {
  document.documentElement.classList.add("js");

  // ---- Header: solid background after scrolling ----
  const header = document.querySelector("[data-header]");
  const onScroll = () => header?.classList.toggle("is-scrolled", window.scrollY > 24);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ---- Mobile navigation (full-screen overlay) ----
  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-nav]");
  const setNav = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
    document.body.classList.toggle("nav-open", open);
  };
  toggle?.addEventListener("click", () => setNav(toggle.getAttribute("aria-expanded") !== "true"));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && nav?.classList.contains("is-open")) setNav(false); });

  // ---- Reveal on scroll ----
  const revealables = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        // small stagger for siblings revealed together
        const siblings = [...el.parentElement.children].filter((n) => n.hasAttribute("data-reveal"));
        el.style.transitionDelay = `${Math.min(siblings.indexOf(el), 5) * 70}ms`;
        el.classList.add("is-in");
        io.unobserve(el);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    revealables.forEach((el) => io.observe(el));
  } else {
    revealables.forEach((el) => el.classList.add("is-in"));
  }

  // ---- Typed text: the line above the jubilee banner appears as if someone is typing it ----
  const typed = document.querySelector("[data-typed]");
  if (typed && typed.textContent.trim() && Intl.Segmenter && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const html = typed.innerHTML;
    const segmenter = new Intl.Segmenter("bn", { granularity: "grapheme" });
    // Each run of text (plain or bold) is split into a typed part and a part still to come.
    const runs = [];
    const walker = document.createTreeWalker(typed, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) runs.push({ node: walker.currentNode });
    runs.forEach((run) => {
      // Whole letters, not code points: a Bengali conjunct (ম্ব্রি) is typed as one piece.
      run.letters = [];
      for (const { segment } of segmenter.segment(run.node.textContent)) {
        if (run.letters.length && run.letters[run.letters.length - 1].endsWith("\u09CD")) run.letters[run.letters.length - 1] += segment;
        else run.letters.push(segment);
      }
      run.done = document.createElement("span");
      run.rest = document.createElement("span");
      run.done.className = "hero-typed-done";
      run.rest.className = "hero-typed-rest";
      run.rest.textContent = run.node.textContent;
      run.node.replaceWith(run.done, run.rest);
    });
    // The box scrolls along with the typing, until the visitor scrolls it themselves.
    let follow = true;
    ["wheel", "touchstart", "keydown"].forEach((name) => typed.addEventListener(name, () => { follow = false; }, { passive: true }));
    const padding = parseFloat(getComputedStyle(typed).paddingBottom);
    let r = 0;
    let i = 0;
    const type = () => {
      const { done, rest, letters } = runs[r];
      i += 1;
      done.classList.add("is-typing");
      done.textContent = letters.slice(0, i).join("");
      rest.textContent = letters.slice(i).join("");
      const lines = done.getClientRects();
      const below = lines.length ? lines[lines.length - 1].bottom - (typed.getBoundingClientRect().bottom - padding) : 0;
      if (follow && below > 0) typed.scrollTop += below;
      const pause = /[।,!\n]/.test(letters[i - 1]) ? 400 : 35;
      const last = r === runs.length - 1;
      if (i >= letters.length && !last) { done.classList.remove("is-typing"); r += 1; i = 0; }
      // a longer pause after a sentence, a comma or a paragraph; the cursor goes away once it is all typed
      if (i < letters.length || !last) setTimeout(type, pause);
      else setTimeout(() => { const top = typed.scrollTop; typed.innerHTML = html; typed.scrollTop = top; }, 2000);
    };
    // start once the line is on screen: on a phone it sits below the first screenful
    const start = () => setTimeout(type, 700);
    if ("IntersectionObserver" in window) {
      const seen = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        seen.disconnect();
        start();
      }, { threshold: 0.5 });
      seen.observe(typed);
    } else {
      start();
    }
  }

  // ---- Event countdowns: a live timer to the start of the event ----
  // Dates and times in site.yaml are in the society's time zone (data-zone), so the
  // timer shows the same thing to a visitor anywhere in the world.
  const inZone = (date, time, zone) => {
    const [y, m, d] = date.split("-").map(Number);
    // The first time in the text is the start: "18:00 – 21:30", or "6PM to 9.30PM".
    const t = (time || "").match(/(\d{1,2})(?:[:.](\d{2}))?\s*([ap])m|(\d{1,2}):(\d{2})/i) || [];
    const hh = t[3] ? (Number(t[1]) % 12) + (t[3].toLowerCase() === "p" ? 12 : 0) : Number(t[4] || 0);
    const mm = Number(t[2] || t[5] || 0);
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
    const p = Object.fromEntries(fmt.formatToParts(guess).map((x) => [x.type, Number(x.value)]));
    return guess - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess);
  };
  const countdowns = [...document.querySelectorAll("[data-countdown]")].map((el) => ({
    el,
    start: inZone(el.dataset.start, el.dataset.time, el.dataset.zone),
    end: inZone(el.dataset.end, "", el.dataset.zone) + 86400000, // the end of the last day
    units: el.dataset.units.split(","),
    parts: null,
  }));
  const tick = () => {
    const now = Date.now();
    countdowns.forEach((c) => {
      if (now >= c.end) { c.el.hidden = true; return; }
      if (now >= c.start) { c.el.textContent = c.el.dataset.labelNow; c.parts = null; c.el.hidden = false; return; }
      if (!c.parts) {
        c.el.textContent = "";
        c.parts = c.units.map((unit) => {
          const part = document.createElement("span");
          const number = part.appendChild(document.createElement("b"));
          part.append(unit);
          c.el.append(part);
          return number;
        });
      }
      const s = Math.floor((c.start - now) / 1000);
      const values = [Math.floor(s / 86400), Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60];
      values.forEach((v, i) => { c.parts[i].textContent = i ? String(v).padStart(2, "0") : v; });
      c.el.hidden = false;
    });
  };
  if (countdowns.length) { tick(); setInterval(tick, 1000); }

  // ---- Gallery lightbox ----
  const dialog = document.querySelector("[data-lightbox-dialog]");
  if (dialog && typeof dialog.showModal === "function") {
    const items = [...document.querySelectorAll("[data-lightbox-item]")];
    const img = dialog.querySelector("img");
    let index = 0;
    const show = (i) => {
      index = (i + items.length) % items.length;
      img.src = items[index].href;
      img.alt = items[index].querySelector("img")?.alt || "";
    };
    items.forEach((a, i) => a.addEventListener("click", (e) => { e.preventDefault(); show(i); dialog.showModal(); }));
    dialog.querySelector("[data-lightbox-close]").addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-lightbox-prev]").addEventListener("click", () => show(index - 1));
    dialog.querySelector("[data-lightbox-next]").addEventListener("click", () => show(index + 1));
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
    document.addEventListener("keydown", (e) => {
      if (!dialog.open) return;
      if (e.key === "ArrowLeft") show(index - 1);
      if (e.key === "ArrowRight") show(index + 1);
    });
  }

  // ---- Contact form (topic chips; ?topic=… preselects one) ----
  const form = document.querySelector("[data-contact-form]");
  if (form) {
    const topic = new URLSearchParams(location.search).get("topic");
    const radio = topic && form.querySelector(`input[name="topic"][value="${CSS.escape(topic)}"]`);
    if (radio) radio.checked = true;

    const status = form.querySelector(".form-status");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      if (!form.getAttribute("action")) {
        // No form service configured: open the visitor's email app instead.
        const label = form.querySelector('input[name="topic"]:checked')?.dataset.label || "";
        const subject = `[ICS website] ${label} — ${data.get("name")}`;
        const body = `${data.get("message")}\n\n${data.get("name")}\n${data.get("email")}`;
        location.href = `mailto:${form.dataset.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        return;
      }
      try {
        const res = await fetch(form.action, { method: "POST", body: data, headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(res.statusText);
        form.reset();
        status.textContent = form.dataset.success;
      } catch {
        status.textContent = form.dataset.error;
      }
    });
  }
})();
