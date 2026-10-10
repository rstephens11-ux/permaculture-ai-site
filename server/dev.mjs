// server/dev.mjs — serves the static site and the API on one port. No Cloudflare account, no keys,
// no dependencies. `node server/dev.mjs` then open http://localhost:8099
//
// This is the thing that gets published behind the tunnel later. In dev it binds localhost only.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createApi, MAX_BODY_BYTES } from "../api/handler.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8099);
const HOST = process.env.HOST || "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8"
};

const api = createApi({ log: (m) => console.log(`[api] ${m}`) });

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

function send(res, status, headers, body) {
  res.writeHead(status, { "cache-control": "no-store", ...headers });
  res.end(body);
}

async function serveStatic(res, urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const rel = clean === "/" ? "/index.html" : clean;
  const full = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!full.startsWith(ROOT)) return send(res, 403, {}, "forbidden");
  try {
    const info = await stat(full);
    if (info.isDirectory()) return serveStatic(res, join(clean, "index.html"));
    const buf = await readFile(full);
    const type = TYPES[extname(full).toLowerCase()] || "application/octet-stream";
    return send(res, 200, { "content-type": type }, buf);
  } catch {
    const body = await readFile(join(ROOT, "404.html")).catch(() => Buffer.from("not found"));
    return send(res, 404, { "content-type": "text/html; charset=utf-8" }, body);
  }
}

const server = createServer(async (req, res) => {
  const url = req.url || "/";

  if (url.startsWith("/api/")) {
    let json = null;
    if (req.method === "POST") {
      try {
        const text = await readBody(req);
        json = text ? JSON.parse(text) : {};
      } catch (err) {
        const tooBig = err && err.message === "body_too_large";
        return send(res, tooBig ? 413 : 400, { "content-type": "application/json" }, JSON.stringify({
          error: tooBig ? "too_large" : "bad_json",
          message: tooBig ? "That photo is too big to send." : "Malformed request."
        }));
      }
    }
    const out = await api.handle({
      method: req.method,
      path: url.split("?")[0],
      ip: clientIp(req),
      json
    });
    return send(res, out.status, { "content-type": "application/json; charset=utf-8" }, JSON.stringify(out.json));
  }

  return serveStatic(res, url);
});

server.listen(PORT, HOST, () => {
  const h = api.engine.name === "forge" ? (process.env.FORGE_BASE_URL || "http://forge:8188") : "n/a (mock)";
  console.log(`permaculture-ai  http://localhost:${PORT}`);
  console.log(`engine: ${api.engine.name}  forge: ${h}`);
  console.log(`caps: ${process.env.PER_IP_PER_DAY || 1}/person/day, ${process.env.GLOBAL_DAILY_CAP || 25}/day total`);
});
