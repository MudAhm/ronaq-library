/**
 * Import local library SQLite into Turso Cloud.
 *
 * Required env:
 *   TURSO_API_TOKEN   — Platform token from https://app.turso.tech (Account / API Tokens)
 *   TURSO_ORG         — org slug (default: ahmed89)
 * Optional:
 *   TURSO_DB_NAME     — default: ronaq
 *   LOCAL_DB          — path to .library_index.sqlite
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = "https://api.turso.tech/v1";
const token = process.env.TURSO_API_TOKEN || "";
const org = process.env.TURSO_ORG || "ahmed89";
const dbName = process.env.TURSO_DB_NAME || "ronaq";

function resolveDb() {
  const c = [
    process.env.LOCAL_DB,
    path.join(process.env.USERPROFILE || "", "Desktop", "RonaqLibrary", "searchbook", ".library_index.sqlite"),
    path.join(process.env.USERPROFILE || "", "Desktop", "searchbook", ".library_index.sqlite"),
    path.join(__dirname, "..", "searchbook", ".library_index.sqlite"),
  ].filter(Boolean);
  for (const p of c) if (fs.existsSync(p)) return p;
  throw new Error("Local SQLite not found");
}

async function api(pathname, opts = {}) {
  const res = await fetch(`${API}${pathname}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${pathname}: ${text}`);
  }
  return json;
}

async function main() {
  if (!token) {
    console.error("Set TURSO_API_TOKEN first (Turso dashboard → API Tokens).");
    process.exit(1);
  }
  const dbPath = resolveDb();
  const size = fs.statSync(dbPath).size;
  console.log("Local DB:", dbPath, `(${(size / 1e9).toFixed(2)} GB)`);
  console.log("Org:", org, "DB:", dbName);

  // Ensure WAL
  // (file already WAL from app)

  console.log("Creating Turso database (upload seed)...");
  try {
    await api(`/organizations/${org}/databases`, {
      method: "POST",
      body: JSON.stringify({
        name: dbName,
        group: "default",
        seed: { type: "database_upload" },
      }),
    });
  } catch (err) {
    if (String(err.message).includes("already") || String(err.message).includes("409")) {
      console.log("Database may already exist, continuing...");
    } else {
      console.warn(err.message);
    }
  }

  console.log("Creating database token...");
  const tok = await api(`/organizations/${org}/databases/${dbName}/auth/tokens`, {
    method: "POST",
    body: JSON.stringify({ expiration: "never", authorization: "full-access" }),
  });
  const dbToken = tok.jwt || tok.token;
  if (!dbToken) throw new Error("No DB token in response: " + JSON.stringify(tok));

  const info = await api(`/organizations/${org}/databases/${dbName}`);
  const hostname =
    info.database?.Hostname ||
    info.database?.hostname ||
    info.Hostname ||
    `${dbName}-${org}.turso.io`;
  console.log("Hostname:", hostname);

  const uploadUrl = `https://${hostname}/v1/upload`;
  console.log("Uploading SQLite (this can take a long time)...");
  const body = fs.readFileSync(dbPath);
  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${dbToken}`,
      "Content-Length": String(body.length),
    },
    body,
  });
  if (!up.ok) {
    const t = await up.text();
    throw new Error(`Upload failed ${up.status}: ${t}`);
  }

  const url = `libsql://${hostname}`;
  console.log("\nDONE");
  console.log("TURSO_DATABASE_URL=" + url);
  console.log("TURSO_AUTH_TOKEN=" + dbToken);
  fs.writeFileSync(
    path.join(__dirname, ".env.turso"),
    `TURSO_DATABASE_URL=${url}\nTURSO_AUTH_TOKEN=${dbToken}\n`,
    "utf8"
  );
  console.log("Saved web/.env.turso — use these to start the web app.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
