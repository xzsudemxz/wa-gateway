// ===== server.js =====
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import * as QR from "qrcode";
import pino from "pino";

// Baileys — compatível com default OU named exports
import pkg from "@whiskeysockets/baileys";
const makeWASocket =
  typeof pkg?.makeWASocket === "function"
    ? pkg.makeWASocket
    : (typeof pkg?.default === "function" ? pkg.default : undefined);

const { useMultiFileAuthState, fetchLatestBaileysVersion } = pkg;

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));

// ----- Config -----
const SECRET  = process.env.WA_GATEWAY_SECRET || "change-me"; // defina no Render!
const AUTH_DIR = process.env.WA_AUTH_DIR || "/tmp/wa_auth";
fs.mkdirSync(AUTH_DIR, { recursive: true });

// Guarda sockets por corretor
const clients = new Map();

// Auth simples via header
function requireAuth(req, res, next) {
  const s = req.header("x-wa-secret");
  if (s !== SECRET) return res.status(401).json({ ok: false, message: "unauthorized" });
  next();
}

// Raiz (pra não dar "Cannot GET /")
app.get("/", (req, res) => {
  res.send("WA Gateway online. Use /health e /session/*");
});

// Health
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

// Iniciar sessão (gera QR ou já retorna connected)
app.post("/session/start", requireAuth, async (req, res) => {
  try {
    const userId = String(req.header("x-user-id") || req.body.userId || "");
    if (!userId) return res.status(400).json({ ok: false, message: "missing userId" });

    if (typeof makeWASocket !== "function") {
      return res.status(500).json({ ok: false, message: "makeWASocket is not a function" });
    }

    const userAuthPath = path.join(AUTH_DIR, userId);
    fs.mkdirSync(userAuthPath, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(userAuthPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      browser: ["CCIA", "Chrome", "1.0"]
    });

    clients.set(userId, sock);
    sock.ev.on("creds.update", saveCreds);

    let responded = false;
    const done = (code, body) => { if (!responded) { responded = true; res.status(code).json(body); } };
    const timer = setTimeout(() => done(504, { ok: false, message: "timeout waiting QR/connection" }), 20000);

    sock.ev.on("connection.update", async (u) => {
      try {
        if (u.qr && !responded) {
          clearTimeout(timer);
          const dataUrl = await QR.toDataURL(u.qr);
          return done(200, { ok: true, status: "qr", dataUrl });
        }
        if (u.connection === "open" && !responded) {
          clearTimeout(timer);
          return done(200, { ok: true, status: "connected", phone: sock.user?.id });
        }
        if (u.connection === "close" && !responded) {
          clearTimeout(timer);
          return done(500, { ok: false, status: "closed" });
        }
      } catch (e) {
        clearTimeout(timer);
        return done(500, { ok: false, message: e.message || String(e) });
      }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message || String(e) });
  }
});

// Status
app.get("/session/status", requireAuth, (req, res) => {
  const userId = String(req.header("x-user-id") || req.query.userId || "");
  const sock = clients.get(userId);
  if (sock?.user?.id) return res.json({ ok: true, status: "connected", phone: sock.user.id });
  return res.json({ ok: true, status: "disconnected" });
});

// Logout
app.post("/session/logout", requireAuth, async (req, res) => {
  const userId = String(req.header("x-user-id") || req.body.userId || "");
  const sock = clients.get(userId);
  try { await sock?.logout(); } catch {}
  clients.delete(userId);
  return res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("WA Gateway ON:", PORT));
// ===== fim server.js =====
