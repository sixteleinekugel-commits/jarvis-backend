import express from "express";
import cors from "cors";
import axios from "axios";
import https from "https";
import http from "http";
import crypto from "crypto";
import nodemailer from "nodemailer";

const app = express();
app.use(cors());
// Augmentation de la limite pour les images haute résolution et les vidéos
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const PORT = process.env.PORT || 10000;
const FRONTEND_URL = "https://sixteleinekugel-commits.github.io/novaAI-chat";
const pendingTokens = new Map();

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
// ROUTES
// ─────────────────────────────────────────────────────────

app.get("/", (req, res) => res.send("Nova AI 618 Backend Ready"));

// /chat
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
    res.status(500).json({ error: "Chat Error: " + err.message });
  }
});

// /code (Laguna M.1)
app.post("/code", async (req, res) => {
  const { messages } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      { model: "poolside/laguna-m.1:free", messages, temperature: 0.2, max_tokens: 8000 },
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 90000 }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: "Code Error: " + err.message });
  }
});

// /analyze (CORRIGÉ : Format Vision)
app.post("/analyze", async (req, res) => {
  const { image, question } = req.body; // image doit être "data:image/jpeg;base64,..."
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!image) return res.status(400).json({ error: "Image manquante" });

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-oss-120b", // Vérifie que ce modèle supporte bien la vision sur OpenRouter
        messages: [{
          role: "user",
          content: [
            { type: "text", text: question || "Décris cette image précisément." },
            { type: "image_url", image_url: { url: image } } // Envoi direct du base64
          ]
        }]
      },
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, timeout: 45000 }
    );
    res.json({ choices: [{ message: { content: response.data?.choices?.[0]?.message?.content } }] });
  } catch (err) {
    console.error("Vision Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Analyse Image échouée" });
  }
});

// /video (CORRIGÉ : Attente du modèle)
app.post("/video", async (req, res) => {
  const { prompt } = req.body;
  const hfToken = process.env.HF_TOKEN?.trim();
  if (!hfToken) return res.status(500).json({ error: "HF_TOKEN Manquant" });

  const HF_URL = "https://api-inference.huggingface.co/models/damo-vilab/text-to-video-ms-1.7b";
  
  try {
    const response = await axios.post(
      HF_URL,
      { inputs: prompt },
      {
        headers: { Authorization: `Bearer ${hfToken}`, "Content-Type": "application/json" },
        responseType: "arraybuffer",
        params: { wait_for_model: true }, // Indique à HF d'attendre que le modèle soit chargé
        timeout: 180000 
      }
    );

    const base64 = Buffer.from(response.data).toString("base64");
    res.json({ video: `data:video/mp4;base64,${base64}`, mime: "video/mp4" });
  } catch (err) {
    console.error("Video Error:", err.message);
    res.status(500).json({ error: "Génération vidéo échouée. Réessayez." });
  }
});

// /image (Flux)
app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&model=flux`;
    const response = await axios.get(url, { responseType: "arraybuffer" });
    res.json({ image: `data:image/jpeg;base64,${Buffer.from(response.data).toString("base64")}` });
  } catch (err) {
    res.status(500).json({ error: "Image Error" });
  }
});

// /search (Tavily)
app.post("/search", async (req, res) => {
  const { query } = req.body;
  try {
    const r = await axios.post("https://api.tavily.com/search", {
      api_key: process.env.TAVILY_API_KEY, query, search_depth: "basic"
    });
    res.json({
        answer: r.data.answer || "",
        context: (r.data.results || []).map(s => s.content).join("\n"),
        sources: r.data.results
    });
  } catch (err) { res.status(500).json({ error: "Search Error" }); }
});

// /send-confirmation & email
app.post("/send-confirmation", async (req, res) => {
  const { email, name } = req.body;
  const token = crypto.randomBytes(32).toString("hex");
  pendingTokens.set(token, { email: email.toLowerCase(), name, expires: Date.now() + 86400000 });
  const transporter = createTransporter();
  if (!transporter) return res.json({ success: true, confirmLink: `${FRONTEND_URL}?confirm=${token}` });

  await transporter.sendMail({
    from: `"Nova AI 618" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: "Confirmation",
    text: `Lien : ${FRONTEND_URL}?confirm=${token}`
  });
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`Nova AI active sur port ${PORT}`));
