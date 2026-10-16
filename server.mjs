/**
 * المكتبة الرونق — Web API + static UI
 * Turso when TURSO_DATABASE_URL + TURSO_AUTH_TOKEN are set,
 * otherwise local SQLite via libsql file: URL.
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createClient } from "@libsql/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}
loadEnvFile(path.join(__dirname, ".env.turso"));
loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 8787);

const TURSO_URL = process.env.TURSO_DATABASE_URL || "";
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || "";

const HIGHLIGHT_OPEN = '<mark class="hit">';
const HIGHLIGHT_CLOSE = "</mark>";
const TASHKEEL_RE = /[\u064B-\u065F\u0670]/g;
const CHAR_MAP = {
  "\u06CC": "\u064A",
  "\u06A9": "\u0643",
  "\u06C0": "\u0647",
  "\u0629": "\u0647",
  "\u0622": "\u0627",
  "\u0623": "\u0627",
  "\u0625": "\u0627",
  "\u0671": "\u0627",
  "\u0649": "\u064A",
};

function normalizeArabic(text) {
  if (!text) return "";
  return Array.from(text)
    .map((ch) => CHAR_MAP[ch] || ch)
    .join("");
}
function removeTashkeel(text) {
  return normalizeArabic(text || "").replace(TASHKEEL_RE, "");
}
function queryWords(query) {
  return (query || "")
    .trim()
    .split(/\s+/)
    .map((w) => normalizeArabic(w.trim()))
    .filter((w) => w.length >= 2);
}
function searchKey(text) {
  return removeTashkeel(normalizeArabic(text || ""));
}
function ftsMatchExpr(words) {
  return words
    .map((w) => `"${searchKey(w).replace(/"/g, "")}"`)
    .filter(Boolean)
    .join(" ");
}
function prepareSnippet(text) {
  if (!text) return "";
  return String(text)
    .replace(/<span[^>]*>/gi, "")
    .replace(/<\/span>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(?!\/?mark\b)[^>]+>/gi, "")
    .trim();
}
function buildSnippet(body, query, maxLen = 220) {
  const cleaned = prepareSnippet(body || "");
  const words = queryWords(query);
  if (!words.length) return cleaned.slice(0, maxLen);
  const hay = searchKey(cleaned);
  const needle = searchKey(words[0]);
  const idx = hay.indexOf(needle);
  const start = idx < 0 ? 0 : Math.max(0, idx - 60);
  const end = Math.min(cleaned.length, start + maxLen);
  let snip =
    (start > 0 ? "..." : "") +
    cleaned.slice(start, end) +
    (end < cleaned.length ? "..." : "");
  for (const w of words) {
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    snip = snip.replace(re, (m) => `${HIGHLIGHT_OPEN}${m}${HIGHLIGHT_CLOSE}`);
  }
  return snip;
}

function resolveLocalDb() {
  const envPath = process.env.LOCAL_DB || "";
  const root = process.env.SEARCHBOOK_ROOT || "";
  const candidates = [
    envPath,
    root ? path.join(root, ".library_index.sqlite") : "",
    path.join(
      process.env.USERPROFILE || "",
      "Desktop",
      "RonaqLibrary",
      "searchbook",
      ".library_index.sqlite"
    ),
    path.join(process.env.USERPROFILE || "", "Desktop", "searchbook", ".library_index.sqlite"),
    path.join(__dirname, "..", "searchbook", ".library_index.sqlite"),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return path.resolve(p);
  }
  return null;
}

const useTurso = Boolean(TURSO_URL && TURSO_TOKEN);
let db = null;
let mode = "none";

if (useTurso) {
  db = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
  mode = "turso";
  console.log("DB mode: Turso");
} else {
  const dbPath = resolveLocalDb();
  if (dbPath) {
    db = createClient({ url: pathToFileURL(dbPath).href });
    mode = "local";
    console.log("DB mode: local", dbPath);
  } else {
    console.error("No DB configured. Set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN");
  }
}

async function sqlAll(query, args = []) {
  if (!db) return [];
  const rs = await db.execute({ sql: query, args });
  return rs.rows.map((row) => {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      // Row as object
      const obj = { ...row };
      for (const col of rs.columns || []) {
        if (obj[col] === undefined && typeof row.get === "function") {
          obj[col] = row.get(col);
        }
      }
      return obj;
    }
    const obj = {};
    (rs.columns || []).forEach((c, i) => {
      obj[c] = row[i];
    });
    return obj;
  });
}

async function handleBook() {
  const books = await sqlAll(
    `SELECT book_id, title, author, page_count, indexed_pages, kind
     FROM books ORDER BY title COLLATE NOCASE`
  );
  const totals = await sqlAll(
    `SELECT COUNT(*) AS book_count,
            COALESCE(SUM(page_count),0) AS total_pages,
            COALESCE(SUM(indexed_pages),0) AS indexed_pages
     FROM books`
  );
  const t = totals[0] || {};
  return {
    library: {
      booksRoot: mode,
      books: books.map((row) => ({
        bookId: Number(row.book_id),
        bookName: row.title,
        authorName: row.author || "",
        pageCount: Number(row.page_count || 0),
        indexedPages: Number(row.indexed_pages || 0),
        startPageNo: 1,
        kind: row.kind || "folder",
      })),
      bookCount: Number(t.book_count || books.length),
      indexing: false,
      ftsReady: true,
      ftsBuilding: false,
      indexedPages: Number(t.indexed_pages || 0),
      totalPages: Number(t.total_pages || 0),
    },
  };
}

async function handleSearch(url) {
  const q = (url.searchParams.get("q") || "").trim();
  const context = (url.searchParams.get("context") || "").trim();
  const modeParam = (url.searchParams.get("mode") || "").toLowerCase();
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 30)));
  const bookIds = (url.searchParams.get("bookIds") || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
  const query = modeParam === "context" || context ? context || q : q;
  const words = queryWords(query);
  if (!words.length) return { results: [], selectedBookIds: bookIds, library: null };

  const match = ftsMatchExpr(words);
  let sql = `
    SELECT p.book_id, p.page_no, p.text, b.title, b.author
    FROM pages_fts
    JOIN pages p ON p.book_id = pages_fts.book_id AND p.page_no = pages_fts.page_no
    JOIN books b ON b.book_id = p.book_id
    WHERE pages_fts MATCH ?
  `;
  const args = [match];
  if (bookIds.length) {
    sql += ` AND p.book_id IN (${bookIds.map(() => "?").join(",")})`;
    args.push(...bookIds);
  }
  sql += ` LIMIT ?`;
  args.push(limit);

  let rows = [];
  try {
    rows = await sqlAll(sql, args);
  } catch (err) {
    console.warn("FTS failed, LIKE fallback:", err.message || err);
    let likeSql = `SELECT p.book_id, p.page_no, p.text, b.title, b.author
                   FROM pages p JOIN books b ON b.book_id = p.book_id WHERE 1=1`;
    const likeArgs = [];
    if (bookIds.length) {
      likeSql += ` AND p.book_id IN (${bookIds.map(() => "?").join(",")})`;
      likeArgs.push(...bookIds);
    }
    likeSql += ` LIMIT 3000`;
    const all = await sqlAll(likeSql, likeArgs);
    const needles = words.map((w) => searchKey(w));
    rows = all
      .filter((row) => {
        const hay = searchKey(row.text || "");
        return needles.every((n) => n && hay.includes(n));
      })
      .slice(0, limit);
  }

  return {
    results: rows.map((row, i) => ({
      pageId: `${row.book_id}-${row.page_no}`,
      bookId: Number(row.book_id),
      pageNo: Number(row.page_no),
      bookName: row.title || `كتاب ${row.book_id}`,
      authorName: row.author || "",
      snippet: buildSnippet(row.text || "", query),
      score: 1000 - i,
    })),
    selectedBookIds: bookIds,
    library: null,
  };
}

async function handlePage(url) {
  const bookId = Number(url.searchParams.get("bookId"));
  const pageNo = Number(url.searchParams.get("pageNo") || url.searchParams.get("page"));
  if (!bookId || !pageNo) return { error: "bookId and pageNo required" };

  const rows = await sqlAll(
    `SELECT p.book_id, p.page_no, p.text, b.title, b.author,
            (SELECT MAX(page_no) FROM pages WHERE book_id = ?) AS max_page
     FROM pages p
     JOIN books b ON b.book_id = p.book_id
     WHERE p.book_id = ? AND p.page_no = ?
     LIMIT 1`,
    [bookId, bookId, pageNo]
  );
  if (!rows.length) return { error: "Page not found" };
  const row = rows[0];
  const text = prepareSnippet(row.text || "");
  const maxPage = Number(row.max_page || pageNo);
  return {
    page: {
      bookId: Number(row.book_id),
      pageNo: Number(row.page_no),
      bookName: row.title,
      authorName: row.author || "",
      text,
      html: text.replace(/\n/g, "<br>"),
      maxPage,
      prevPage: pageNo > 1 ? pageNo - 1 : null,
      nextPage: pageNo < maxPage ? pageNo + 1 : null,
    },
  };
}

function sendJson(res, payload, status = 200) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  return "application/octet-stream";
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "*",
      });
      return res.end();
    }

    if (url.pathname === "/api/book") return sendJson(res, await handleBook());
    if (url.pathname === "/api/search") return sendJson(res, await handleSearch(url));
    if (url.pathname === "/api/page") {
      const payload = await handlePage(url);
      return sendJson(res, payload, payload.error ? 404 : 200);
    }
    if (url.pathname === "/api/health") {
      return sendJson(res, { ok: true, mode });
    }

    let rel = url.pathname.replace(/^\//, "");
    if (!rel || rel === "ronaq" || rel === "ronaq/") rel = "index.html";
    const filePath = path.join(PUBLIC, rel);
    if (!filePath.startsWith(PUBLIC) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(data);
  } catch (err) {
    console.error(err);
    sendJson(res, { error: String(err.message || err) }, 500);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`المكتبة الرونق web: http://127.0.0.1:${PORT}/`);
  console.log(`mode=${mode}`);
});
