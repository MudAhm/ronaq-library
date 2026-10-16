import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const pub = join(__dirname, "..", "public");
mkdirSync(pub, { recursive: true });

const html = readFileSync(join(root, "ronaq.html"), "utf8");
writeFileSync(join(pub, "index.html"), html, "utf8");
copyFileSync(join(root, "ronaq.css"), join(pub, "ronaq.css"));
copyFileSync(join(root, "ronaq.js"), join(pub, "ronaq.js"));
console.log("UI copied to web/public");
