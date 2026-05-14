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

// Helper pour récupérer du binaire (utilisé pour les images/vidéos)
async function fetchBinary(url, timeoutMs = 60000) {
  const response = await axios.get(url, { 
    responseType: "arraybuffer", 
    timeout: timeoutMs,
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  return Buffer.from(response.data);
}

// ─────────────────────────────────────────────────────────
// ROUTES PRINCIPALES
// ─────────────────────────────────────────────────────────

app.get("/", (req, res) => res.send("Nova AI 618 Backend — Operational"));

// --- ANALYSE D'IMAGE (GROQ VISION) ---
app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;
  const groqKey = process.env.GROQ_API_KEY?.trim();
  
  if (!groqKey) return res.status(500).json({ error: "GROQ_API_KEY non configurée dans Render" });
  if (!image) return res.status(400).json({ error: "Aucune image reçue" });

  try {
    console.log("[/analyze] Envoi vers Groq Vision...");
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.2-11b-vision-preview", // Modèle stable et ultra-rapide
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: question || "Describe this image in detail." },
              { type: "image_url", image_url: { url: image } }
            ]
          }
        ],
        temperature: 0.5,
        max_tokens: 1024
      },
      { headers: { "Authorization": `Bearer ${groqKey}`, "Content-Type": "application/json" } }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    res.json({ choices: [{ message: { content } }] });
  } catch (err) {
    console.error("Groq Error:", err.response?.data || err.message);
    const msg = err.response?.data?.error?.message || "Erreur de clé ou de quota Groq";
    res.status(500).json({ error: "Vision Error: " + msg });
  }
});

// --- GÉNÉRATION VIDÉO (POLLINATIONS LATTE) ---
app.post("/video", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt requis" });

  try {
    console.log(`[/video] Génération: ${prompt.slice(0, 50)}...`);
    // Modèle Latte sur Pollinations (plus stable que HF en mode gratuit)
    const videoUrl = `https://video.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=latte&seed=${Date.now()}`;
    
    const buffer = await fetchBinary(videoUrl, 90000);
    const base64 = buffer.toString("base64");

    if (base64.length < 1000) throw new Error("Fichier vidéo invalide ou trop petit");

    console.log("[/video] OK - Taille:", Math.round(buffer.length/1024), "KB");
    res.json({ video: `data:video/mp4;base64,${base64}`, mime: "video/mp4" });
  } catch (err) {
    console.error("Video Error:", err.message);
    res.status(500).json({ error: "La génération vidéo a échoué. Réessayez dans un instant." });
  }
});

// --- CHAT (OPENROUTER) ---
app.post("/chat", async (req, res) => {
  const { messages, model, temperature } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const selectedModel = MODEL_MAP[model] || "openai/gpt-oss-120b";

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      { model: selectedModel, messages, temperature: temperature ?? 0.7, max_tokens: 4000 },
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 40000 }
    );
    res.json(response.data);
  } catch (err) { res.status(500).json({ error: "Chat Error: " + err.message }); }
});

// --- CODE (LAGUNA) ---
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

// --- IMAGE (FLUX) ---
app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&model=flux&seed=${Date.now()}`;
    const buf = await fetchBinary(url);
    res.json({ image: `data:image/jpeg;base64,${buf.toString("base64")}` });
  } catch (err) { res.status(500).json({ error: "Image Error" }); }
});

// --- SEARCH (TAVILY) ---
app.post("/search", async (req, res) => {
  const { query } = req.body;
  try {
    const r = await axios.post("https://api.tavily.com/search", {
      api_key: process.env.TAVILY_API_KEY, query, search_depth: "basic", include_answer: true
    });
    res.json({
      answer: r.data.answer || "",
      context: (r.data.results || []).map(s => s.content).join("\n"),
      sources: r.data.results
    });
  } catch (err) { res.status(500).json({ error: "Search Error" }); }
});

// ─────────────────────────────────────────────────────────
// SYSTÈME DE CONFIRMATION (Email)
// ─────────────────────────────────────────────────────────

app.post("/send-confirmation", async (req, res) => {
  const { email, name } = req.body;
  const token = crypto.randomBytes(32).toString("hex");
  pendingTokens.set(token, { email: email.toLowerCase(), name, expires: Date.now() + 86400000 });
  const confirmLink = `${FRONTEND_URL}?confirm=${token}`;
  
  const transporter = createTransporter();
  if (!transporter) return res.json({ success: true, confirmLink, emailSent: false });

  try {
    await transporter.sendMail({
      from: `"Nova AI 618" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "Confirm your Nova AI account",
      html: `<div style="background:#0b0c12; color:#fff; padding:20px; border-radius:10px; font-family:sans-serif;">
              <h2>Welcome to Nova AI 618</h2>
              <p>Hello ${name}, click the button below to verify your account.</p>
              <a href="${confirmLink}" style="background:#7c6aff; color:#fff; padding:10px 20px; text-decoration:none; border-radius:5px; display:inline-block;">Confirm Account</a>
             </div>`
    });
    res.json({ success: true, emailSent: true });
  } catch (err) { res.json({ success: true, confirmLink, emailSent: false }); }
});

app.get("/verify-email", (req, res) => {
  const { token } = req.query;
  const data = pendingTokens.get(token);
  if (!data || Date.now() > data.expires) return res.status(400).json({ error: "Invalid token" });
  pendingTokens.delete(token);
  res.json({ success: true, email: data.email, name: data.name });
});

// ─────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  🚀 Nova AI 618 — Serveur démarré sur le port ${PORT}
  Clés détectées :
  - Groq (Vision) : ${process.env.GROQ_API_KEY ? "✅" : "❌"}
  - OpenRouter    : ${process.env.OPENROUTER_API_KEY ? "✅" : "❌"}
  - Tavily        : ${process.env.TAVILY_API_KEY ? "✅" : "❌"}
  `);
});
