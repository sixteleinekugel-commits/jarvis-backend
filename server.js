import express from "express";
import cors from "cors";
import axios from "axios";
import https from "https";
import http from "http";
import crypto from "crypto";
import nodemailer from "nodemailer";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 10000;
const FRONTEND_URL = "https://sixteleinekugel-commits.github.io/novaAI-chat";
const pendingTokens = new Map();

// ─────────────────────────────────────────────────────────
// CONFIGURATION DES MODÈLES
// ─────────────────────────────────────────────────────────
const MODEL_MAP = {
  "openai/gpt-oss-120b":      "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile": "meta-llama/llama-3.3-70b-instruct:free",
  "llama-3.1-8b-instant":    "meta-llama/llama-3.1-8b-instruct:free"
};

function createTransporter() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
}

// Helper pour convertir une URL d'image en Base64 pour le frontend
function fetchBinary(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const timer = setTimeout(() => reject(new Error("Timeout")), timeoutMs);
    const req = lib.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        clearTimeout(timer);
        return fetchBinary(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
    });
    req.on("error", e => { clearTimeout(timer); reject(e); });
  });
}

// ─────────────────────────────────────────────────────────
// ROUTES API
// ─────────────────────────────────────────────────────────

app.get("/", (req, res) => res.send("Nova AI 618 Backend — Operational"));

// --- CHAT (OpenRouter) ---
app.post("/chat", async (req, res) => {
  const { messages, model, temperature } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const selectedModel = MODEL_MAP[model] || "openai/gpt-oss-120b";

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      { model: selectedModel, messages, temperature: temperature ?? 0.7, max_tokens: 4000 },
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, timeout: 40000 }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: "Chat Error: " + (err.response?.data?.error?.message || err.message) });
  }
});

// --- CODE (Laguna M.1 - 8000 tokens) ---
app.post("/code", async (req, res) => {
  const { messages } = req.body;
  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      { model: "poolside/laguna-m.1:free", messages, temperature: 0.1, max_tokens: 8000 },
      { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }, timeout: 90000 }
    );
    res.json(response.data);
  } catch (err) { res.status(500).json({ error: "Code Error" }); }
});

// --- IMAGE (MODIFIÉ : OpenRouter Free Switch) ---
app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!prompt) return res.status(400).json({ error: "Prompt requis" });

  try {
    console.log(`[/image] Génération via OpenRouter Free Router...`);
    const response = await axios.post(
      "https://openrouter.ai/api/v1/images/generations",
      {
        model: "openrouter/free", // Utilise dynamiquement le meilleur modèle gratuit (SDXL ou autre)
        prompt: prompt,
        response_format: "url"
      },
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": FRONTEND_URL,
          "X-Title": "Nova AI 618"
        },
        timeout: 60000
      }
    );

    const imageUrl = response.data?.data?.[0]?.url;
    if (!imageUrl) throw new Error("Le routeur gratuit n'a pas pu générer d'image.");

    const buf = await fetchBinary(imageUrl, 30000);
    res.json({ image: `data:image/jpeg;base64,${buf.toString("base64")}` });

  } catch (err) {
    console.error("Image Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Génération échouée", details: err.message });
  }
});

// --- ANALYSE D'IMAGE (Vision) ---
app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;
  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-oss-120b",
        messages: [{ role: "user", content: [
          { type: "image_url", image_url: { url: image } },
          { type: "text", text: question || "Analyze this image." }
        ]}]
      },
      { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }, timeout: 45000 }
    );
    res.json({ choices: [{ message: { content: response.data?.choices?.[0]?.message?.content } }] });
  } catch (err) { res.status(500).json({ error: "Vision Error" }); }
});

// --- RECHERCHE (Tavily) ---
app.post("/search", async (req, res) => {
  const { query } = req.body;
  try {
    const r = await axios.post("https://api.tavily.com/search", {
      api_key: process.env.TAVILY_API_KEY, query, search_depth: "basic", include_answer: true
    });
    res.json({
      answer: r.data.answer || "",
      context: (r.data.results || []).map(s => `[${s.title}]\n${s.content}`).join("\n"),
      sources: r.data.results
    });
  } catch (err) { res.status(500).json({ error: "Search Error" }); }
});

// --- VIDÉO (Hugging Face avec Retry) ---
app.post("/video", async (req, res) => {
  const { prompt } = req.body;
  const HF_URL = "https://api-inference.huggingface.co/models/damo-vilab/text-to-video-ms-1.7b";
  try {
    const response = await axios.post(HF_URL, { inputs: prompt }, { 
        responseType: "arraybuffer", 
        timeout: 150000 
    });
    const base64 = Buffer.from(response.data).toString("base64");
    res.json({ video: `data:video/mp4;base64,${base64}`, mime: "video/mp4" });
  } catch (err) { res.status(500).json({ error: "Video model is loading, try again in 1 minute." }); }
});

// --- SYSTÈME D'EMAIL & CONFIRMATION ---
app.post("/send-confirmation", async (req, res) => {
  const { email, name } = req.body;
  const token = crypto.randomBytes(32).toString("hex");
  pendingTokens.set(token, { email: email.toLowerCase(), name, expires: Date.now() + 86400000 });
  
  const transporter = createTransporter();
  const confirmLink = `${FRONTEND_URL}?confirm=${token}`;

  if (!transporter) return res.json({ success: true, confirmLink, emailSent: false });

  try {
    await transporter.sendMail({
      from: `"Nova AI 618" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "Activate your Nova AI account",
      html: `<div style="background:#0b0c12; color:#fff; padding:30px; font-family:sans-serif; border-radius:15px;">
              <h1 style="color:#7c6aff;">Nova AI 618</h1>
              <p>Welcome <b>${name}</b>,</p>
              <p>Click the button below to confirm your email and start using Nova.</p>
              <a href="${confirmLink}" style="display:inline-block; padding:12px 25px; background:#7c6aff; color:#fff; text-decoration:none; border-radius:8px; font-weight:bold;">Confirm Account</a>
              <p style="font-size:12px; color:#555; margin-top:20px;">This link will expire in 24 hours.</p>
            </div>`
    });
    res.json({ success: true, emailSent: true });
  } catch (err) { res.json({ success: true, confirmLink, emailSent: false }); }
});

app.get("/verify-email", (req, res) => {
  const { token } = req.query;
  const data = pendingTokens.get(token);
  if (!data || Date.now() > data.expires) return res.status(400).json({ error: "Invalid/Expired" });
  pendingTokens.delete(token);
  res.json({ success: true, email: data.email, name: data.name });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Nova AI 618 Backend Active`);
  console.log(`Mode Image : OpenRouter Free (Auto-Switch)`);
});
