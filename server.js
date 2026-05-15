import express from "express";
import cors from "cors";
import axios from "axios";
import https from "https";
import http from "http";
import crypto from "crypto";
import nodemailer from "nodemailer";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" })); // Augmenté pour les vidéos base64

const PORT = process.env.PORT || 10000;
const FRONTEND_URL = "https://sixteleinekugel-commits.github.io/novaAI-chat";
const pendingTokens = new Map();

// ─────────────────────────────────────────────────────────
// CONFIGURATION MODÈLES
// ─────────────────────────────────────────────────────────
const DEFAULT_MODEL = "google/gemma-4-31b-it:free";

// Mappage strict pour éviter les erreurs undefined
const MODEL_MAP = {
  "google/gemma-4-31b-it:free": "google/gemma-4-31b-it:free",
  "openai/gpt-oss-120b": "openai/gpt-oss-120b"
};

function createTransporter() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
}

// ─────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────

app.get("/", (req, res) => res.send("Nova AI 618 Backend Online"));

app.get("/debug-env", (req, res) => {
  res.json({
    OPENROUTER_KEY: process.env.OPENROUTER_API_KEY ? "CONFIGURED" : "MISSING",
    MODEL_ACTIVE: DEFAULT_MODEL,
    TIME: new Date().toISOString()
  });
});

// /CHAT
app.post("/chat", async (req, res) => {
  const { messages, model, temperature } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) return res.status(500).json({ error: "API Key non configurée" });

  const selectedModel = MODEL_MAP[model] || DEFAULT_MODEL;

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: selectedModel,
        messages: messages,
        temperature: temperature ?? 0.7,
        max_tokens: 4000
      },
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": FRONTEND_URL,
          "X-Title": "Nova AI 618",
          "Content-Type": "application/json"
        },
        timeout: 60000
      }
    );
    res.json(response.data);
  } catch (err) {
    console.error("Chat Error:", err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// /ANALYZE (IMAGE & VIDEO)
app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!image) return res.status(400).json({ error: "Contenu manquant" });

  const isVideo = image.startsWith("data:video/");
  
  // Formatage correct pour Gemma 4 Multimodal
  const userContent = [
    { type: "text", text: question || "Analyse ce contenu." }
  ];

  if (isVideo) {
    userContent.push({ type: "video_url", video_url: { url: image } });
  } else {
    userContent.push({ type: "image_url", image_url: { url: image } });
  }

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: DEFAULT_MODEL,
        messages: [{ role: "user", content: userContent }],
        max_tokens: 1500
      },
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": FRONTEND_URL
        },
        timeout: 90000 // Plus long pour l'upload vision
      }
    );
    res.json(response.data);
  } catch (err) {
    console.error("Analyze Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Erreur d'analyse vision" });
  }
});

// /IMAGE (POLLINATIONS)
app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  try {
    const seed = Math.floor(Math.random() * 1000000);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&model=flux&seed=${seed}`;
    
    // Utilisation de fetch natif (Node 18+) ou axios pour plus de stabilité
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const base64 = Buffer.from(response.data, 'binary').toString('base64');
    res.json({ image: `data:image/jpeg;base64,${base64}` });
  } catch (err) {
    res.status(500).json({ error: "Génération d'image échouée" });
  }
});

// /SEARCH (TAVILY)
app.post("/search", async (req, res) => {
  const { query } = req.body;
  if (!process.env.TAVILY_API_KEY) return res.status(500).json({ error: "Clé Tavily manquante" });

  try {
    const r = await axios.post("https://api.tavily.com/search", {
      api_key: process.env.TAVILY_API_KEY,
      query: query,
      include_answer: true
    });
    res.json({
      answer: r.data.answer,
      sources: r.data.results.map(s => ({ title: s.title, url: s.url }))
    });
  } catch (err) {
    res.status(500).json({ error: "Recherche échouée" });
  }
});

// Le reste de tes routes (confirmation, verify, code...) reste identique
// mais assure-toi de bien utiliser des try/catch partout.

app.listen(PORT, () => {
  console.log(`🚀 Nova AI 618 prêt sur le port ${PORT}`);
});
