import express from "express";
import multer from "multer";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 3000);
const TARGET_URL =
  process.env.TARGET_URL ||
  "http://patagonia.serveftp.com/modules/icewhale_files/#/files/HDD-500/UPLOAD%20EXT";
const TARGET_MODE = (process.env.TARGET_MODE || "webdav").toLowerCase();
const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 5120);
const UPLOAD_DIR = process.env.UPLOAD_DIR || "/uploads";
const UPLOAD_USER = process.env.UPLOAD_USER || "";
const UPLOAD_PASS = process.env.UPLOAD_PASS || "";
const PUBLIC_BASE_PATH = normalizeBasePath(process.env.PUBLIC_BASE_PATH || "/");
const PUBLIC_URL =
  process.env.PUBLIC_URL ||
  "http://patagonia.serveftp.com/modules/icewhale_files/#/files/HDD-500/UPLOAD%20EXT";

const app = express();
const router = express.Router();
const uploadRoot = path.join(os.tmpdir(), "internal-uploader");
const upload = multer({
  dest: uploadRoot,
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024
  }
});

router.use(express.static("public"));

router.get("/api/config", (_req, res) => {
  res.json({
    targetUrl: TARGET_URL,
    publicUrl: PUBLIC_URL,
    publicBasePath: PUBLIC_BASE_PATH,
    targetMode: TARGET_MODE,
    uploadDir: TARGET_MODE === "local" ? UPLOAD_DIR : undefined,
    maxFileSizeMb: MAX_FILE_SIZE_MB,
    hashUrlWarning: TARGET_URL.includes("#")
  });
});

router.post("/api/upload", upload.array("files"), async (req, res) => {
  const user = String(req.body.user || "");
  const pass = String(req.body.pass || "");
  const paths = normalizePaths(req.body.relativePaths);

  if (!user || !pass) {
    await cleanup(req.files);
    return res.status(400).json({ error: "Faltan usuario o contraseña." });
  }

  if (UPLOAD_USER && UPLOAD_PASS && (user !== UPLOAD_USER || pass !== UPLOAD_PASS)) {
    await cleanup(req.files);
    return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
  }

  if (!req.files?.length) {
    return res.status(400).json({ error: "No se recibieron archivos." });
  }

  const authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  const results = [];

  try {
    for (const [index, file] of req.files.entries()) {
      const relativePath = sanitizeRelativePath(paths[index] || file.originalname);
      const result = await uploadFile(file, relativePath, authorization);

      results.push(result);
    }

    const failed = results.filter((item) => !item.ok);
    res.status(failed.length ? 502 : 200).json({
      ok: failed.length === 0,
      uploaded: results.length - failed.length,
      failed: failed.length,
      results
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Error inesperado." });
  } finally {
    await cleanup(req.files);
  }
});

app.use(PUBLIC_BASE_PATH, router);

if (PUBLIC_BASE_PATH !== "/") {
  app.get("/", (_req, res) => res.redirect(PUBLIC_BASE_PATH));
}

app.listen(PORT, () => {
  console.log(`Uploader listening on http://0.0.0.0:${PORT}`);
  console.log(`Public base path: ${PUBLIC_BASE_PATH}`);
  console.log(`Target mode: ${TARGET_MODE}`);
  console.log(`Upload dir: ${UPLOAD_DIR}`);
});

function normalizeBasePath(value) {
  const normalized = `/${String(value || "/")
    .trim()
    .replace(/^\/+|\/+$/g, "")}`;
  return normalized === "/" ? "/" : normalized;
}

async function uploadFile(file, relativePath, authorization) {
  if (TARGET_MODE === "local") {
    return saveLocal(file, relativePath);
  }

  if (TARGET_MODE === "post") {
    return uploadWithPost(file, relativePath, authorization);
  }

  return uploadWithWebDav(file, relativePath, authorization);
}

async function saveLocal(file, relativePath) {
  const safePath = sanitizeRelativePath(relativePath);
  const destination = path.resolve(UPLOAD_DIR, safePath);
  const root = path.resolve(UPLOAD_DIR);

  if (destination !== root && !destination.startsWith(`${root}${path.sep}`)) {
    return {
      id: crypto.randomUUID(),
      path: relativePath,
      ok: false,
      status: 400,
      message: "Ruta invalida."
    };
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(file.path, destination);
  const stat = await fs.stat(destination);
  console.log(`Saved upload: ${safePath} -> ${destination} (${stat.size} bytes)`);

  return {
    id: crypto.randomUUID(),
    path: safePath,
    savedTo: destination,
    size: stat.size,
    ok: true,
    status: 201,
    message: "Guardado"
  };
}

function normalizePaths(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function sanitizeRelativePath(value) {
  return String(value)
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

async function uploadWithWebDav(file, relativePath, authorization) {
  const url = buildTargetUrl(relativePath);
  await ensureWebDavFolders(relativePath, authorization);

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      authorization,
      "content-type": file.mimetype || "application/octet-stream",
      "content-length": String(file.size)
    },
    body: createReadStream(file.path),
    duplex: "half"
  });

  return responseToResult(response, relativePath);
}

async function ensureWebDavFolders(relativePath, authorization) {
  const folders = relativePath.split("/").slice(0, -1);
  let current = "";

  for (const folder of folders) {
    current = current ? `${current}/${folder}` : folder;
    await fetch(buildTargetUrl(`${current}/`), {
      method: "MKCOL",
      headers: { authorization }
    });
  }
}

async function uploadWithPost(file, relativePath, authorization) {
  const form = new FormData();
  const bytes = await fs.readFile(file.path);
  form.set("file", new Blob([bytes], { type: file.mimetype || "application/octet-stream" }), path.basename(relativePath));
  form.set("path", relativePath);

  const response = await fetch(stripHash(TARGET_URL), {
    method: "POST",
    headers: { authorization },
    body: form
  });

  return responseToResult(response, relativePath);
}

function buildTargetUrl(relativePath) {
  const base = stripHash(TARGET_URL).replace(/\/+$/, "");
  const encodedPath = relativePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${base}/${encodedPath}`;
}

function stripHash(url) {
  return url.split("#")[0];
}

async function responseToResult(response, relativePath) {
  const requestId = crypto.randomUUID();
  const message = response.ok ? "Subido" : await safeResponseText(response);

  return {
    id: requestId,
    path: relativePath,
    ok: response.ok || response.status === 201 || response.status === 204,
    status: response.status,
    message
  };
}

async function safeResponseText(response) {
  try {
    const text = await response.text();
    return text.slice(0, 500) || response.statusText;
  } catch {
    return response.statusText;
  }
}

async function cleanup(files = []) {
  await Promise.all(
    files.map((file) => fs.rm(file.path, { force: true }).catch(() => undefined))
  );
}
