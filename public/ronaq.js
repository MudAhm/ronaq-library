const form = document.getElementById("searchForm");
const queryInput = document.getElementById("query");
const contextQueryInput = document.getElementById("contextQuery");
const searchBtn = document.getElementById("searchBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const searchViewEl = document.getElementById("searchView");
const readerViewEl = document.getElementById("readerView");
const readerBackBtn = document.getElementById("readerBack");
const readerPrevBtn = document.getElementById("readerPrev");
const readerNextBtn = document.getElementById("readerNext");
const readerPrevNoEl = document.getElementById("readerPrevNo");
const readerNextNoEl = document.getElementById("readerNextNo");
const readerPageInput = document.getElementById("readerPageInput");
const readerPageSlider = document.getElementById("readerPageSlider");
const readerPageMaxEl = document.getElementById("readerPageMax");
const readerEdgePrevBtn = document.getElementById("readerEdgePrev");
const readerEdgeNextBtn = document.getElementById("readerEdgeNext");
const readerBodyEl = document.getElementById("readerBody");
const readerBookTitleEl = document.getElementById("readerBookTitle");
const readerBookMetaRowEl = document.getElementById("readerBookMetaRow");
const citationBtn = document.getElementById("citationBtn");
const bookListEl = document.getElementById("bookList");
const bookFilterEl = document.getElementById("bookFilter");
const booksPanelCountEl = document.getElementById("booksPanelCount");
const booksSelectedCountEl = document.getElementById("booksSelectedCount");
const clearBookSelectionBtn = document.getElementById("clearBookSelection");

const API_BASE = window.location.origin;
const selectedBookIds = new Set();

const HONORIFIC_LIGATURES = {
  "\uFD40": "رحمه الله",
  "\uFD41": "رضي الله عنه",
  "\uFD42": "رضي الله عنها",
  "\uFD43": "رضي الله عنهم",
  "\uFD44": "رضي الله عنهما",
  "\uFD45": "رضي الله عنهن",
  "\uFD46": "صلى الله عليه وآله",
  "\uFD47": "عليه السلام",
  "\uFD48": "عليهم السلام",
  "\uFD49": "عليهما السلام",
  "\uFD4A": "عليه الصلاة والسلام",
  "\uFD4B": "قدس سره",
  "\uFD4C": "صلى الله عليه وآله وسلم",
  "\uFD4D": "عليها السلام",
  "\uFD4E": "تبارك وتعالى",
  "\uFD4F": "رحمهم الله",
  "\uFDFA": "صلى الله عليه وسلم",
  "\uFDFD": "بسم الله الرحمن الرحيم",
  "\uFDFE": "سبحانه وتعالى",
  "\uFDFF": "عز وجل",
};

const ARABIC_SIGN_HONORIFICS = {
  "\u0610": "صلى الله عليه وسلم",
  "\u0611": "عليه السلام",
  "\u0612": "رحمه الله",
  "\u0613": "رضي الله عنه",
};

function expandArabicHonorifics(text) {
  let expanded = String(text);
  for (const [symbol, phrase] of Object.entries(HONORIFIC_LIGATURES)) {
    expanded = expanded.replaceAll(symbol, phrase);
  }
  for (const [symbol, phrase] of Object.entries(ARABIC_SIGN_HONORIFICS)) {
    expanded = expanded.replaceAll(symbol, ` ${phrase} `);
  }
  return expanded;
}

let libraryInfo = null;
let activeBookId = null;
let lastSearchQuery = "";
let readerHighlightQuery = "";
let currentPage = null;
let scrollNavLock = false;
let scrollNavReadyAt = 0;
let pageLoading = false;
let sliderJumpTimer = null;
const SCROLL_EDGE_PX = 40;

function lockScrollNav(ms = 600) {
  scrollNavLock = true;
  scrollNavReadyAt = Date.now() + ms;
  window.setTimeout(() => {
    scrollNavLock = false;
  }, ms);
}

function canScrollNavigate() {
  return !scrollNavLock && !pageLoading && Date.now() >= scrollNavReadyAt;
}

function isReaderScrollable() {
  return readerBodyEl.scrollHeight > readerBodyEl.clientHeight + 4;
}

function atReaderTop() {
  return readerBodyEl.scrollTop <= SCROLL_EDGE_PX;
}

function atReaderBottom() {
  return (
    readerBodyEl.scrollTop + readerBodyEl.clientHeight
    >= readerBodyEl.scrollHeight - SCROLL_EDGE_PX
  );
}

function navigateReaderPage(direction) {
  if (!currentPage || !canScrollNavigate()) {
    return;
  }

  if (direction === "next" && currentPage.nextPageNo) {
    lockScrollNav(800);
    openPage(currentPage.bookId, currentPage.nextPageNo, "start");
    return;
  }

  if (direction === "prev" && currentPage.prevPageNo) {
    lockScrollNav(800);
    openPage(currentPage.bookId, currentPage.prevPageNo, "end");
  }
}

function goToReaderPage(pageNo, scrollAnchor = "auto") {
  if (!currentPage) {
    return;
  }

  const target = Number(pageNo);
  if (!Number.isFinite(target)) {
    return;
  }

  if (target === currentPage.pageNo) {
    if (readerHighlightQuery) {
      lockScrollNav(500);
      openPage(currentPage.bookId, target, "highlight");
    }
    return;
  }

  if (currentPage.minPageNo && target < currentPage.minPageNo) {
    return;
  }

  if (currentPage.maxPageNo && target > currentPage.maxPageNo) {
    return;
  }

  lockScrollNav(500);
  openPage(currentPage.bookId, target, scrollAnchor);
}

function jumpFromPageInput() {
  if (!currentPage) {
    return;
  }
  goToReaderPage(Number(readerPageInput.value), "start");
}

function scheduleSliderJump(pageNo) {
  window.clearTimeout(sliderJumpTimer);
  sliderJumpTimer = window.setTimeout(() => {
    goToReaderPage(Number(pageNo), "start");
  }, 100);
}

function applyReaderScrollAnchor(scrollAnchor) {
  if (scrollAnchor === "end") {
    readerBodyEl.scrollTop = readerBodyEl.scrollHeight;
    return;
  }

  if (scrollAnchor === "start") {
    readerBodyEl.scrollTop = 0;
    return;
  }

  const firstHit = readerBodyEl.querySelector("mark.hit");
  if (firstHit) {
    const container = readerBodyEl;
    const containerRect = container.getBoundingClientRect();
    const elementRect = firstHit.getBoundingClientRect();
    const delta = elementRect.top - containerRect.top;
    const target =
      container.scrollTop + delta - container.clientHeight / 2 + elementRect.height / 2;

    container.scrollTo({
      top: Math.max(0, target),
      behavior: "smooth",
    });
    lockScrollNav(900);
    return;
  }

  readerBodyEl.scrollTop = 0;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderSnippet(snippet) {
  const OPEN = "@@HIT_OPEN@@";
  const CLOSE = "@@HIT_CLOSE@@";

  let text = expandArabicHonorifics(String(snippet))
    .replace(/<mark[^>]*>/gi, OPEN)
    .replace(/<\/mark>/gi, CLOSE)
    .replace(/<b>/gi, OPEN)
    .replace(/<\/b>/gi, CLOSE)
    .replace(/<strong>/gi, OPEN)
    .replace(/<\/strong>/gi, CLOSE)
    .replace(/<[^>]+>/g, "");

  text = escapeHtml(text);

  return text
    .replaceAll(OPEN, '<mark class="hit">')
    .replaceAll(CLOSE, "</mark>");
}

function renderPageBody(body) {
  const OPEN = "@@HIT_OPEN@@";
  const CLOSE = "@@HIT_CLOSE@@";

  let text = expandArabicHonorifics(String(body))
    .replace(/<mark[^>]*>/gi, OPEN)
    .replace(/<\/mark>/gi, CLOSE)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  text = escapeHtml(text);

  return text
    .replaceAll(OPEN, '<mark class="hit">')
    .replaceAll(CLOSE, "</mark>")
    .replace(/\r?\n/g, "<br>");
}

function setActiveBookItem(bookId) {
  activeBookId = bookId ? Number(bookId) : null;
  bookListEl.querySelectorAll(".book-list-item").forEach((item) => {
    item.classList.toggle("is-active", Number(item.dataset.bookId) === activeBookId);
  });
}

function updateBookSelectionUi() {
  const count = selectedBookIds.size;
  if (count === 0) {
    booksSelectedCountEl.textContent = "کوئی کتاب منتخب نہیں — تمام کتب میں تلاش";
    clearBookSelectionBtn.classList.add("hidden");
  } else {
    booksSelectedCountEl.textContent = `تلاش کے لیے منتخب: ${count} کتاب`;
    clearBookSelectionBtn.classList.remove("hidden");
  }

  bookListEl.querySelectorAll(".book-list-item").forEach((item) => {
    const bookId = Number(item.dataset.bookId);
    const checked = selectedBookIds.has(bookId);
    item.classList.toggle("is-checked", checked);
    const checkbox = item.querySelector(".book-list-item__check");
    if (checkbox) {
      checkbox.checked = checked;
    }
  });
}

function toggleBookSelection(bookId, checked) {
  const id = Number(bookId);
  if (!Number.isFinite(id)) {
    return;
  }
  if (checked) {
    selectedBookIds.add(id);
  } else {
    selectedBookIds.delete(id);
  }
  updateBookSelectionUi();
}

function clearBookSelection() {
  selectedBookIds.clear();
  updateBookSelectionUi();
}

function getSelectedBookIds() {
  return Array.from(selectedBookIds);
}

function renderBookList(books, filterText = "") {
  const query = filterText.trim().toLowerCase();
  const filtered = (books || []).filter((book) => {
    if (!query) {
      return true;
    }
    const haystack = `${book.bookName || ""} ${book.authorName || ""}`.toLowerCase();
    return haystack.includes(query);
  });

  booksPanelCountEl.textContent = query
    ? `${filtered.length} از ${books.length}`
    : `${books.length} کتاب`;

  if (!filtered.length) {
    bookListEl.innerHTML = '<p class="books-panel-empty">کوئی مماثل کتاب نہیں ملی۔</p>';
    updateBookSelectionUi();
    return;
  }

  bookListEl.innerHTML = filtered
    .map((book) => {
      const ready = book.indexedPages > 0;
      const progress = book.pageCount
        ? `${book.indexedPages}/${book.pageCount} صفحہ`
        : `${book.indexedPages} صفحہ`;
      const metaParts = [];
      if (book.authorName) {
        metaParts.push(escapeHtml(book.authorName));
      }
      metaParts.push(ready ? progress : "فہرست سازی جاری...");
      const bookId = Number(book.bookId);
      const isChecked = selectedBookIds.has(bookId);
      const isActive = bookId === activeBookId;
      return `
        <div
          class="book-list-item${isActive ? " is-active" : ""}${isChecked ? " is-checked" : ""}"
          data-book-id="${book.bookId}"
          data-start-page="${book.startPageNo || 1}"
          role="option"
        >
          <input
            class="book-list-item__check"
            type="checkbox"
            ${isChecked ? "checked" : ""}
            aria-label="تلاش کے لیے منتخب: ${escapeHtml(book.bookName || "کتاب")}"
          >
          <button
            type="button"
            class="book-list-item__open"
            data-book-id="${book.bookId}"
            data-start-page="${book.startPageNo || 1}"
          >
            <h3 class="book-list-item__title">${escapeHtml(book.bookName || "کتاب")}</h3>
            <p class="book-list-item__meta">${metaParts.join(" · ")}</p>
          </button>
        </div>
      `;
    })
    .join("");

  updateBookSelectionUi();
}

function openBookFromList(bookId, startPageNo) {
  readerHighlightQuery = "";
  setActiveBookItem(bookId);
  openPage(bookId, startPageNo || 1, "start");
}

function renderResults(payload) {
  if (!payload.results.length) {
    const modeLabel = payload.mode === "context" ? "سیاق و سباق" : "لفظ";
    resultsEl.innerHTML = `<div class="empty-state">«${escapeHtml(payload.query)}» کے لیے کوئی نتیجہ نہیں ملا (${modeLabel})۔</div>`;
    return;
  }

  resultsEl.innerHTML = payload.results
    .map((item, index) => `
        <button
          type="button"
          class="result-item"
          data-page-id="${escapeHtml(item.pageId)}"
          data-book-id="${item.bookId}"
          data-page-no="${item.pageNo}"
        >
          <div class="result-head">
            <h2 class="result-title">${index + 1}. ${escapeHtml(item.bookName || "کتاب")}</h2>
            <p class="result-meta">صفحہ ${item.pageNo}${item.authorName ? ` · ${escapeHtml(item.authorName)}` : ""}</p>
          </div>
          <p class="result-snippet">${renderSnippet(item.snippet)}</p>
        </button>
      `)
    .join("");
}

function showSearchView() {
  readerViewEl.classList.add("hidden");
  searchViewEl.classList.remove("hidden");
  form.classList.remove("hidden");
  statusEl.classList.remove("hidden");
}

function showReaderView() {
  searchViewEl.classList.add("hidden");
  readerViewEl.classList.remove("hidden");
  form.classList.add("hidden");
  statusEl.classList.add("hidden");
}

function resolveScrollAnchor(requested, hasHits) {
  if (readerHighlightQuery && hasHits) {
    return "highlight";
  }

  if (requested === "auto") {
    return "start";
  }

  return requested;
}

function renderReader(page, scrollAnchor = "highlight") {
  currentPage = page;

  const minPage = page.minPageNo || 1;
  const maxPage = page.maxPageNo || page.pageNo;
  readerPageInput.min = String(minPage);
  readerPageInput.max = String(maxPage);
  readerPageInput.value = String(page.pageNo);
  readerPageSlider.min = String(minPage);
  readerPageSlider.max = String(maxPage);
  readerPageSlider.value = String(page.pageNo);
  readerPageMaxEl.textContent = `از ${maxPage}`;

  if (page.prevPageNo) {
    readerPrevNoEl.textContent = `صفحہ ${page.prevPageNo}`;
    readerPrevBtn.disabled = false;
    readerEdgePrevBtn.disabled = false;
  } else {
    readerPrevNoEl.textContent = "\u00a0";
    readerPrevBtn.disabled = true;
    readerEdgePrevBtn.disabled = true;
  }

  if (page.nextPageNo) {
    readerNextNoEl.textContent = `صفحۃ ${page.nextPageNo}`;
    readerNextBtn.disabled = false;
    readerEdgeNextBtn.disabled = false;
  } else {
    readerNextNoEl.textContent = "\u00a0";
    readerNextBtn.disabled = true;
    readerEdgeNextBtn.disabled = true;
  }

  readerBodyEl.innerHTML = renderPageBody(page.body);
  const hasHits = !!readerBodyEl.querySelector("mark.hit");
  const anchor = resolveScrollAnchor(scrollAnchor, hasHits);

  if (page.bookName) {
    readerBookTitleEl.textContent = page.authorName
      ? `${page.bookName} · ${page.authorName}`
      : page.bookName;
    readerBookMetaRowEl?.classList.remove("hidden");
  } else {
    readerBookTitleEl.textContent = "";
    readerBookMetaRowEl?.classList.add("hidden");
  }
  if (citationBtn) {
    citationBtn.textContent = "حوالہ";
    citationBtn.classList.remove("is-copied");
    citationBtn.disabled = !page.citation;
    citationBtn.title = page.citation
      ? `کاپی: ${page.citation}`
      : "حوالہ دستیاب نہیں";
  }

  setActiveBookItem(page.bookId);

  window.requestAnimationFrame(() => {
    lockScrollNav(500);
    applyReaderScrollAnchor(anchor);
  });
}

function libraryStatusText(library) {
  if (!library) {
    return "";
  }

  const bookCount = library.bookCount || 0;
  const indexedPages = library.indexedPages || 0;
  const totalPages = library.totalPages || 0;

  if (library.indexing && indexedPages < totalPages) {
    return `کتب کی فہرست سازی جاری ہے (${indexedPages} از ${totalPages} صفحہ)...`;
  }

  if (library.ftsBuilding && !library.ftsReady) {
    return `تیز تلاش تیار ہو رہی ہے (${indexedPages} صفحہ)...`;
  }

  if (!bookCount) {
    return "ابھی لائبریری فولڈر میں کوئی کتاب نہیں ہے۔";
  }

  return `${bookCount} کتاب · ${indexedPages} صفحے فہرست میں`;
}

async function loadLibrary() {
  booksPanelCountEl.textContent = "...";
  bookListEl.innerHTML = '<p class="books-panel-empty">کتب لوڈ ہو رہی ہیں...</p>';
  try {
    const response = await fetch(new URL("/api/book", API_BASE));
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "کتب کی فہرست لوڈ نہیں ہو سکی۔");
    }
    libraryInfo = payload.library || null;
    statusEl.textContent = libraryStatusText(libraryInfo);
    renderBookList(libraryInfo?.books || [], bookFilterEl.value);
  } catch {
    libraryInfo = null;
    booksPanelCountEl.textContent = "";
    bookListEl.innerHTML = '<p class="books-panel-empty">کتب کی فہرست لوڈ نہیں ہو سکی۔</p>';
  }
}

async function openPage(bookId, pageNo, scrollAnchor = "highlight") {
  pageLoading = true;
  const keepReaderContent = !readerViewEl.classList.contains("hidden") && currentPage;

  if (keepReaderContent) {
    readerBodyEl.classList.add("is-loading");
  } else {
    readerBodyEl.innerHTML = '<p class="reader-loading">صفحہ کھولا جا رہا ہے...</p>';
    showReaderView();
  }

  try {
    const url = new URL("/api/page", API_BASE);
    url.searchParams.set("bookId", String(bookId));
    url.searchParams.set("pageNo", String(pageNo));
    if (readerHighlightQuery) {
      url.searchParams.set("q", readerHighlightQuery);
    }

    const response = await fetch(url);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "صفحہ نہیں کھل سکا۔");
    }

    renderReader(payload.page, scrollAnchor);
  } catch (error) {
    readerBodyEl.classList.remove("is-loading");
    readerBodyEl.innerHTML = `<div class="empty-state">${escapeHtml(error.message || "صفحہ نہیں کھل سکا۔")}</div>`;
    readerPrevBtn.disabled = true;
    readerNextBtn.disabled = true;
  } finally {
    readerBodyEl.classList.remove("is-loading");
    pageLoading = false;
  }
}

async function runSearch({ query = "", context = "", mode = "word" } = {}) {
  searchBtn.disabled = true;
  const selectedIds = getSelectedBookIds();
  const activeText = mode === "context" ? context : query;
  const modeLabel = mode === "context" ? "سیاق و سباق" : "لفظی";
  statusEl.textContent = selectedIds.length
    ? `${modeLabel} تلاش: ${selectedIds.length} منتخب کتابوں میں...`
    : `${modeLabel} تلاش: تمام لائبریری میں...`;
  resultsEl.innerHTML = "";
  showSearchView();

  try {
    const url = new URL("/api/search", API_BASE);
    url.searchParams.set("mode", mode);
    url.searchParams.set("limit", "40");
    if (mode === "context") {
      url.searchParams.set("context", context);
    } else {
      url.searchParams.set("q", query);
    }
    if (selectedIds.length) {
      url.searchParams.set("bookIds", selectedIds.join(","));
    }

    const response = await fetch(url);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "تلاش مکمل نہیں ہو سکی۔");
    }

    if (payload.library) {
      libraryInfo = payload.library;
      renderBookList(libraryInfo.books || [], bookFilterEl.value);
    } else if (payload.indexStatus && libraryInfo) {
      libraryInfo = {
        ...libraryInfo,
        indexing: payload.indexStatus.indexing,
        ftsBuilding: payload.indexStatus.ftsBuilding,
        ftsReady: payload.indexStatus.ftsReady,
        indexedPages: payload.indexStatus.indexedPages,
        totalPages: payload.indexStatus.totalPages,
        bookCount: payload.indexStatus.bookCount,
      };
    }

    lastSearchQuery = payload.query;
    readerHighlightQuery = payload.query;
    const indexNote = libraryInfo?.indexing && libraryInfo.indexedPages < libraryInfo.totalPages
      ? " (فہرست سازی ابھی جاری ہے)"
      : libraryInfo?.ftsBuilding && !libraryInfo?.ftsReady
        ? " (تیز تلاش تیار ہو رہی ہے)"
        : "";
    const scopeNote = selectedIds.length
      ? ` — ${selectedIds.length} منتخب کتابوں میں`
      : " — تمام کتب میں";
    const kindNote = payload.mode === "context"
      ? " (ایک صفحہ یا قریبی ±1 صفحہ)"
      : "";
    statusEl.textContent = `«${payload.query}» کے لیے ${payload.total} نتائج ملے${scopeNote}${kindNote}${indexNote}۔`;
    renderResults(payload);
  } catch (error) {
    statusEl.textContent = error.message || "تلاش کے دوران خرابی ہوئی۔";
    resultsEl.innerHTML = `<div class="empty-state">یقینی بنائیں کہ سرور چل رہا ہے:<br><code>python tools/shamila_server.py</code></div>`;
  } finally {
    searchBtn.disabled = false;
  }
}

loadLibrary();

bookFilterEl.addEventListener("input", (event) => {
  renderBookList(libraryInfo?.books || [], event.target.value);
});

bookListEl.addEventListener("click", (event) => {
  const checkbox = event.target.closest(".book-list-item__check");
  if (checkbox) {
    const item = checkbox.closest(".book-list-item");
    if (!item) {
      return;
    }
    toggleBookSelection(item.dataset.bookId, checkbox.checked);
    return;
  }

  const openBtn = event.target.closest(".book-list-item__open");
  if (!openBtn) {
    return;
  }

  openBookFromList(openBtn.dataset.bookId, openBtn.dataset.startPage);
});

bookListEl.addEventListener("change", (event) => {
  const checkbox = event.target.closest(".book-list-item__check");
  if (!checkbox) {
    return;
  }
  const item = checkbox.closest(".book-list-item");
  if (!item) {
    return;
  }
  toggleBookSelection(item.dataset.bookId, checkbox.checked);
});

clearBookSelectionBtn.addEventListener("click", () => {
  clearBookSelection();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = queryInput.value.trim();
  const context = (contextQueryInput?.value || "").trim();
  if (!query && !context) {
    statusEl.textContent = "لفظی تلاش یا سیاق و سباق میں کچھ لکھیں، پھر تلاش کریں۔";
    return;
  }
  if (context) {
    runSearch({ query, context, mode: "context" });
    return;
  }
  runSearch({ query, context: "", mode: "word" });
});

resultsEl.addEventListener("click", (event) => {
  const item = event.target.closest(".result-item");
  if (!item) {
    return;
  }

  readerHighlightQuery = lastSearchQuery;
  setActiveBookItem(item.dataset.bookId);
  openPage(item.dataset.bookId, item.dataset.pageNo, "highlight");
});

async function copyCitation() {
  if (!currentPage?.citation || !citationBtn) {
    return;
  }
  const text = String(currentPage.citation);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
    citationBtn.textContent = "کاپی ہو گیا";
    citationBtn.classList.add("is-copied");
    window.setTimeout(() => {
      if (!citationBtn) {
        return;
      }
      citationBtn.textContent = "حوالہ";
      citationBtn.classList.remove("is-copied");
    }, 1600);
  } catch {
    citationBtn.textContent = "کاپی نہیں ہوا";
    window.setTimeout(() => {
      if (citationBtn) {
        citationBtn.textContent = "حوالہ";
      }
    }, 1600);
  }
}

readerBackBtn.addEventListener("click", () => {
  showSearchView();
});

citationBtn?.addEventListener("click", () => {
  copyCitation();
});

readerPrevBtn.addEventListener("click", () => {
  if (!currentPage?.prevPageNo) {
    return;
  }
  openPage(currentPage.bookId, currentPage.prevPageNo, "end");
});

readerNextBtn.addEventListener("click", () => {
  if (!currentPage?.nextPageNo) {
    return;
  }
  openPage(currentPage.bookId, currentPage.nextPageNo, "start");
});

readerEdgePrevBtn.addEventListener("click", () => {
  if (!currentPage?.prevPageNo) {
    return;
  }
  openPage(currentPage.bookId, currentPage.prevPageNo, "end");
});

readerEdgeNextBtn.addEventListener("click", () => {
  if (!currentPage?.nextPageNo) {
    return;
  }
  openPage(currentPage.bookId, currentPage.nextPageNo, "start");
});

readerPageInput.addEventListener("change", jumpFromPageInput);
readerPageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    jumpFromPageInput();
    readerPageInput.blur();
  }
});

readerPageSlider.addEventListener("input", (event) => {
  const pageNo = Number(event.target.value);
  readerPageInput.value = String(pageNo);
  scheduleSliderJump(pageNo);
});

readerBodyEl.addEventListener("scroll", () => {
  if (readerViewEl.classList.contains("hidden") || !canScrollNavigate()) {
    return;
  }

  if (!isReaderScrollable()) {
    return;
  }

  if (atReaderBottom()) {
    navigateReaderPage("next");
  } else if (atReaderTop()) {
    navigateReaderPage("prev");
  }
});

readerBodyEl.addEventListener("wheel", (event) => {
  if (readerViewEl.classList.contains("hidden") || !canScrollNavigate()) {
    return;
  }

  const scrollingDown = event.deltaY > 0;
  const scrollingUp = event.deltaY < 0;
  const scrollable = isReaderScrollable();

  if (scrollingDown && (!scrollable || atReaderBottom())) {
    if (currentPage?.nextPageNo) {
      event.preventDefault();
      navigateReaderPage("next");
    }
    return;
  }

  if (scrollingUp && (!scrollable || atReaderTop())) {
    if (currentPage?.prevPageNo) {
      event.preventDefault();
      navigateReaderPage("prev");
    }
  }
}, { passive: false });

document.addEventListener("keydown", (event) => {
  if (readerViewEl.classList.contains("hidden")) {
    return;
  }

  if (event.key === "ArrowRight" && currentPage?.prevPageNo) {
    event.preventDefault();
    openPage(currentPage.bookId, currentPage.prevPageNo, "end");
  }

  if (event.key === "ArrowLeft" && currentPage?.nextPageNo) {
    event.preventDefault();
    openPage(currentPage.bookId, currentPage.nextPageNo, "start");
  }

  if (event.key === "PageUp" && currentPage?.prevPageNo) {
    event.preventDefault();
    openPage(currentPage.bookId, currentPage.prevPageNo, "end");
  }

  if (event.key === "PageDown" && currentPage?.nextPageNo) {
    event.preventDefault();
    openPage(currentPage.bookId, currentPage.nextPageNo, "start");
  }

  if (event.key === "Escape") {
    showSearchView();
  }
});
