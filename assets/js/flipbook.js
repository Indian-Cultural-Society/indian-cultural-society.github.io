// ICS Cambridge — design v2. The magazine flipbook: turns the stacked page images into a book
// whose pages turn, using StPageFlip (assets/js/vendor/). Without it the pages stay stacked.
(() => {
  const root = document.querySelector("[data-flipbook]");
  const book = root?.querySelector("[data-flipbook-book]");
  if (!book) return;
  if (!window.St) { root.classList.add("is-stacked"); return; }

  const pages = [...book.querySelectorAll(".flipbook-page")];
  const images = pages.map((page) => page.querySelector("img"));
  const { pageWidth, pageHeight, labelPage, labelPages, labelOf } = book.dataset;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const flip = new St.PageFlip(book, {
    width: Number(pageWidth),
    height: Number(pageHeight),
    size: "stretch",
    // below twice this width (most phones) the book shows one page at a time
    minWidth: 260,
    maxWidth: Number(pageWidth),
    minHeight: 340,
    maxHeight: Number(pageHeight),
    showCover: true,
    maxShadowOpacity: 0.4,
    flippingTime: still ? 1 : 800,
  });
  flip.loadFromHTML(pages);
  root.classList.add("is-book");

  const controls = root.querySelector("[data-flipbook-controls]");
  const prev = root.querySelector("[data-flipbook-prev]");
  const next = root.querySelector("[data-flipbook-next]");
  const count = root.querySelector("[data-flipbook-count]");
  const full = root.querySelector("[data-flipbook-full]");
  controls.hidden = false;

  const update = () => {
    const i = flip.getCurrentPageIndex();
    const n = flip.getPageCount();
    // the front and back covers are shown alone; the pages between them in pairs on a wide screen
    const pair = flip.getOrientation() === "landscape" && i > 0 && i < n - 1;
    count.textContent = pair ? `${labelPages} ${i + 1}–${i + 2} ${labelOf} ${n}` : `${labelPage} ${i + 1} ${labelOf} ${n}`;
    prev.disabled = i === 0;
    next.disabled = i + (pair ? 2 : 1) >= n;
    // fetch the pages either side now, so they are ready before they are turned to
    images.slice(Math.max(0, i - 2), i + 6).forEach((img) => { img.loading = "eager"; });
  };
  flip.on("flip", update);
  flip.on("changeOrientation", update);
  update();

  prev.addEventListener("click", () => flip.flipPrev());
  next.addEventListener("click", () => flip.flipNext());
  document.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target.closest("input, textarea, select")) return;
    if (e.key === "ArrowLeft") flip.flipPrev();
    if (e.key === "ArrowRight") flip.flipNext();
  });

  // Full screen isn't available everywhere (iPhones only allow it for videos)
  if (!root.requestFullscreen) {
    full.hidden = true;
  } else {
    full.addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else root.requestFullscreen();
    });
    document.addEventListener("fullscreenchange", () => {
      full.textContent = document.fullscreenElement ? full.dataset.labelExit : full.dataset.labelEnter;
    });
  }
})();
