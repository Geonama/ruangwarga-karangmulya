const crypto = require("crypto");
const path = require("path");
const cors = require("cors");
const dotenv = require("dotenv");
const express = require("express");
const multer = require("multer");
const { Pool } = require("pg");
const { PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-southeast-1";
const S3_UPLOAD_BUCKET = process.env.S3_UPLOAD_BUCKET || "";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const DATABASE_URL = process.env.DATABASE_URL || "";
const usingDatabase = Boolean(DATABASE_URL || process.env.DB_HOST);

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const s3 = S3_UPLOAD_BUCKET ? new S3Client({ region: AWS_REGION }) : null;
const pool = usingDatabase
  ? new Pool({
      connectionString: DATABASE_URL || undefined,
      host: process.env.DB_HOST || undefined,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || undefined,
      user: process.env.DB_USER || undefined,
      password: process.env.DB_PASSWORD || undefined,
      ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
    })
  : null;

const memoryRecords = [
  {
    id: "RW-2026-1042",
    type: "Surat",
    name: "Alya Nuraini",
    nik: "",
    detail: "Surat Keterangan Domisili",
    location: "RT 02/RW 04",
    description: "",
    fileName: "ktp-alya.pdf",
    fileKey: "",
    status: "Diproses",
    createdAt: "2026-05-07T09:10:00.000Z",
  },
];

app.use(cors({ origin: CORS_ORIGIN === "*" ? "*" : CORS_ORIGIN.split(",").map((item) => item.trim()) }));
app.use(express.json());
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.get("/", (_request, response) => response.sendFile(path.join(__dirname, "index.html")));
app.get("/index.html", (_request, response) => response.sendFile(path.join(__dirname, "index.html")));
app.get("/styles.css", (_request, response) => response.sendFile(path.join(__dirname, "styles.css")));
app.get("/app.js", (_request, response) => response.sendFile(path.join(__dirname, "app.js")));
app.get("/config.js", (_request, response) => response.sendFile(path.join(__dirname, "config.js")));
app.get("/favicon.ico", (_request, response) => response.status(204).end());

app.get("/health", async (_request, response) => {
  try {
    if (pool) await pool.query("select 1");
    response.json({ ok: true, database: pool ? "connected" : "memory", storage: s3 ? "s3" : "memory" });
  } catch (error) {
    response.status(500).json({ ok: false, message: error.message });
  }
});

app.get("/api/records", async (_request, response, next) => {
  try {
    const records = await listRecords();
    response.json(records);
  } catch (error) {
    next(error);
  }
});

app.get("/api/records/:id", async (request, response, next) => {
  try {
    const record = await findRecord(request.params.id);
    if (!record) return response.status(404).json({ message: "Tiket tidak ditemukan." });
    response.json(record);
  } catch (error) {
    next(error);
  }
});

app.post("/api/letters", upload.single("file"), async (request, response, next) => {
  try {
    const id = createTicketId();
    const fileInfo = await saveUpload(id, request.file);
    const record = {
      id,
      type: "Surat",
      name: clean(request.body.name),
      nik: clean(request.body.nik),
      detail: clean(request.body.service),
      location: clean(request.body.address),
      description: `Jadwal ambil: ${clean(request.body.pickup)}`,
      fileName: fileInfo.fileName,
      fileKey: fileInfo.fileKey,
      status: "Diterima",
      createdAt: new Date().toISOString(),
    };
    validateRecord(record);
    await insertRecord(record);
    response.status(201).json(record);
  } catch (error) {
    next(error);
  }
});

app.post("/api/complaints", upload.single("file"), async (request, response, next) => {
  try {
    const id = createTicketId();
    const fileInfo = await saveUpload(id, request.file);
    const record = {
      id,
      type: "Pengaduan",
      name: clean(request.body.name),
      nik: "",
      detail: clean(request.body.category),
      location: clean(request.body.location),
      description: clean(request.body.description),
      fileName: fileInfo.fileName,
      fileKey: fileInfo.fileKey,
      status: "Diterima",
      createdAt: new Date().toISOString(),
    };
    validateRecord(record);
    await insertRecord(record);
    response.status(201).json(record);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/records/:id/status", async (request, response, next) => {
  try {
    const status = clean(request.body.status);
    if (!["Diterima", "Diverifikasi", "Diproses", "Selesai"].includes(status)) {
      return response.status(400).json({ message: "Status tidak valid." });
    }
    const record = await updateStatus(request.params.id, status);
    if (!record) return response.status(404).json({ message: "Tiket tidak ditemukan." });
    response.json(record);
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(error.status || 500).json({ message: error.message || "Terjadi kesalahan server." });
});

async function initDatabase() {
  if (!pool) return;
  await pool.query(`
    create table if not exists service_records (
      id varchar(32) primary key,
      type varchar(32) not null,
      name varchar(160) not null,
      nik varchar(32),
      detail varchar(160) not null,
      location text not null,
      description text,
      file_name varchar(255),
      file_key varchar(512),
      status varchar(32) not null default 'Diterima',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
}

async function listRecords() {
  if (!pool) return [...memoryRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const result = await pool.query("select * from service_records order by created_at desc");
  return result.rows.map(toRecord);
}

async function findRecord(id) {
  if (!pool) return memoryRecords.find((record) => record.id === id) || null;
  const result = await pool.query("select * from service_records where id = $1", [id]);
  return result.rows[0] ? toRecord(result.rows[0]) : null;
}

async function insertRecord(record) {
  if (!pool) {
    memoryRecords.unshift(record);
    return record;
  }
  await pool.query(
    `insert into service_records
      (id, type, name, nik, detail, location, description, file_name, file_key, status, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())`,
    [
      record.id,
      record.type,
      record.name,
      record.nik,
      record.detail,
      record.location,
      record.description,
      record.fileName,
      record.fileKey,
      record.status,
      record.createdAt,
    ],
  );
  return record;
}

async function updateStatus(id, status) {
  if (!pool) {
    const record = memoryRecords.find((item) => item.id === id);
    if (!record) return null;
    record.status = status;
    return record;
  }
  const result = await pool.query(
    "update service_records set status = $1, updated_at = now() where id = $2 returning *",
    [status, id],
  );
  return result.rows[0] ? toRecord(result.rows[0]) : null;
}

async function saveUpload(ticketId, file) {
  if (!file) {
    const error = new Error("File pendukung wajib diunggah.");
    error.status = 400;
    throw error;
  }

  const fileName = sanitizeFileName(file.originalname || "berkas");
  const fileKey = `uploads/${ticketId}-${Date.now()}-${fileName}`;
  if (s3) {
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_UPLOAD_BUCKET,
        Key: fileKey,
        Body: file.buffer,
        ContentType: file.mimetype || "application/octet-stream",
      }),
    );
  }
  return { fileName, fileKey };
}

function validateRecord(record) {
  const missing = ["name", "detail", "location", "fileName"].filter((field) => !record[field]);
  if (missing.length) {
    const error = new Error(`Field belum lengkap: ${missing.join(", ")}.`);
    error.status = 400;
    throw error;
  }
}

function toRecord(row) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    nik: row.nik || "",
    detail: row.detail,
    location: row.location,
    description: row.description || "",
    fileName: row.file_name || "",
    fileKey: row.file_key || "",
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

function createTicketId() {
  const year = new Date().getFullYear();
  const suffix = crypto.randomInt(1000, 9999);
  return `RW-${year}-${suffix}`;
}

function sanitizeFileName(value) {
  const parsed = path.parse(value);
  const base = parsed.name.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "berkas";
  const ext = parsed.ext.replace(/[^a-z0-9.]/gi, "").toLowerCase();
  return `${base}${ext}`;
}

function clean(value) {
  return String(value || "").trim();
}

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`RuangWarga API berjalan di port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Gagal menyiapkan database:", error);
    process.exit(1);
  });
