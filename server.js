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

// ─────────────────────────────────────────────────────────
// ANALYSE D'IMAGE (GROQ - llama-4-scout-17b)
// ─────────────────────────────────────────────────────────
app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;
  const groqKey = process.env.GROQ_API_KEY?.trim();
  
  if (!groqKey) return res.status(500).json({ error: "GROQ_API_KEY non configurée" });
  if (!image) return res.status(400).json({ error: "Image manquante" });

  try {
    console.log("[/analyze] Envoi à Groq...");
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
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
      {
        headers: {
          "Authorization": `Bearer ${groqKey}`,
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    res.json({ choices: [{ message: { content } }] });
  } catch (err) {
    console.error("Groq Vision Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Erreur Groq Vision : " + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GÉNÉRATION VIDÉO (HUGGING FACE - Version Corrigée)
// ─────────────────────────────────────────────────────────
app.post("/video", async (req, res) => {
  const { prompt } = req.body;
  const hfToken = process.env.HF_TOKEN?.trim();
  if (!hfToken) return res.status(500).json({ error: "HF_TOKEN absent" });

  try {
    console.log("[/video] Génération Hugging Face...");
    const response = await axios.post(
      "https://api-inference.huggingface.co/models/damo-vilab/text-to-video-ms-1.7b",
      { inputs: prompt },
      {
        headers: { 
          "Authorization": `Bearer ${hfToken}`,
          "Content-Type": "application/json" 
        },
        responseType: "arraybuffer",
        params: { wait_for_model: true }, // Crucial pour réveiller le modèle
        timeout: 180000
      }
    );

    const base64 = Buffer.from(response.data).toString("base64");
    res.json({ video: `data:video/mp4;base64,${base64}`, mime: "video/mp4" });
  } catch (err) {
    console.error("Video Error:", err.message);
    res.status(500).json({ error: "Échec vidéo : " + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// TOUTES LES AUTRES FONCTIONS (Chat, Code, Image, Email)
// ─────────────────────────────────────────────────────────

app.post("/chat", async (req, res) => {
  const { messages, model, temperature } = req.body;
  const selectedModel = MODEL_MAP[model] || "openai/gpt-oss-120b";
  try {
    const r = await axios.post("https://openrouter.ai/api/v1/chat/completions", 
      { model: selectedModel, messages, temperature: temperature ?? 0.7, max_tokens: 4000 },
      { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }}
    );
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/code", async (req, res) => {
  const { messages } = req.body;
  try {
    const r = await axios.post("https://openrouter.ai/api/v1/chat/completions", 
      { model: "poolside/laguna-m.1:free", messages, temperature: 0.2, max_tokens: 8000 },
      { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }, timeout: 90000}
    );
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&model=flux&seed=${Date.now()}`;
    const response = await axios.get(url, { responseType: "arraybuffer" });
    res.json({ image: `data:image/jpeg;base64,${Buffer.from(response.data).toString("base64")}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/search", async (req, res) => {
  const { query } = req.body;
  try {
    const r = await axios.post("https://api.tavily.com/search", {
      api_key: process.env.TAVILY_API_KEY, query, search_depth: "basic"
    });
    res.json({ answer: r.data.answer, context: r.data.results.map(s => s.content).join("\n"), sources: r.data.results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Système de confirmation d'email
app.post("/send-confirmation", async (req, res) => {
  const { email, name } = req.body;
  const token = crypto.randomBytes(32).toString("hex");
  pendingTokens.set(token, { email: email.toLowerCase(), name, expires: Date.now() + 86400000 });
  const transporter = createTransporter();
  const confirmLink = `${FRONTEND_URL}?confirm=${token}`;
  if (!transporter) return res.json({ success: true, confirmLink });

  try {
    await transporter.sendMail({
      from: `"Nova AI 618" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "Confirm your Nova AI 618 account",
      html: `<h1>Welcome ${name}</h1><p>Click here: <a href="${confirmLink}">${confirmLink}</a></p>`
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

app.listen(PORT, () => console.log(`🚀 Nova AI 618 — Port ${PORT} (Groq Vision & HF Video active)`));
