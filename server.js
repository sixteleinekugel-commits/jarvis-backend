import express from "express";
import cors from "cors";
import axios from "axios";
import https from "https";
import http from "http";
import crypto from "crypto";
import nodemailer from "nodemailer";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 10000;
const FRONTEND_URL = "https://sixteleinekugel-commits.github.io/novaAI-chat";
const pendingTokens = new Map();

// ─────────────────────────────────────────────────────────
// CONFIGURATION MODÈLES (Gemma 4 31B - Multimodal)
// ─────────────────────────────────────────────────────────
const DEFAULT_MODEL = "google/gemma-4-31b-it:free";

// Mappage pour assurer la compatibilité si le frontend envoie d'anciens noms
const MODEL_MAP = {
  "google/gemma-4-31b-it:free": "google/gemma-4-31b-it:free",
  "openai/gpt-oss-120b": "google/gemma-4-31b-it:free"
};

function createTransporter() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
}

// ─────────────────────────────────────────────────────────
// ROUTES DE BASE
// ─────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send("Nova AI 618 Backend — Gemma 4 Edition");
});

app.get("/debug-env", (req, res) => {
  const or = process.env.OPENROUTER_API_KEY;
  res.json({
    OPENROUTER_API_KEY: or ? `OK (${or.slice(0, 8)}...)` : "ABSENT",
    server_time: new Date().toISOString(),
    model_active: DEFAULT_MODEL
  });
});

// ─────────────────────────────────────────────────────────
// /chat — Gemma 4 31B
// ─────────────────────────────────────────────────────────
app.post("/chat", async (req, res) => {
  const { messages, model, temperature } = req.body;
  if (!messages || !Array.isArray(messages))
    return res.status(400).json({ error: "messages array required" });

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return res.status(500).json({ error: "API Key missing" });

  const selectedModel = MODEL_MAP[model] || DEFAULT_MODEL;

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: selectedModel,
        messages,
        temperature: temperature ?? 0.7,
        max_tokens: 4000
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": FRONTEND_URL,
          "X-Title": "Nova AI 618"
        },
        timeout: 60000
      }
    );
    res.json(response.data);
  } catch (err) {
    console.error("[/chat] Error:", err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// /analyze — Gemma 4 Vision (Native)
// ─────────────────────────────────────────────────────────
app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;
  if (!image) return res.status(400).json({ error: "image required" });

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const prompt = question || "Analyze this content in detail.";

  // Gemma 4 supporte les types image_url et video_url nativement
  const isVideo = image.startsWith("data:video/");
  const content = [
    { type: isVideo ? "video_url" : "image_url", [isVideo ? "video_url" : "image_url"]: { url: image } },
    { type: "text", text: prompt }
  ];

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: DEFAULT_MODEL,
        messages: [{ role: "user", content }],
        max_tokens: 2000
      },
      {
        headers: { Authorization: `Bearer ${apiKey}`, "HTTP-Referer": FRONTEND_URL }
      }
    );
    res.json({ choices: [{ message: { content: response.data.choices[0].message.content } }] });
  } catch (err) {
    res.status(500).json({ error: "Analysis failed: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// /code — Laguna M.1
// ─────────────────────────────────────────────────────────
app.post("/code", async (req, res) => {
  const { messages } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "poolside/laguna-m.1:free",
        messages,
        temperature: 0.2,
        max_tokens: 8000
      },
      { headers: { Authorization: `Bearer ${apiKey}`, "HTTP-Referer": FRONTEND_URL } }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: "Code generation error" });
  }
});

// ─────────────────────────────────────────────────────────
// AUTRES SERVICES (Search, Image, Video, Email)
// ─────────────────────────────────────────────────────────

app.post("/search", async (req, res) => {
  const { query } = req.body;
  if (!process.env.TAVILY_API_KEY) return res.status(500).json({ error: "No Tavily Key" });

  try {
    const r = await axios.post("https://api.tavily.com/search", {
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: "basic"
    });
    res.json({ answer: r.data.answer, sources: r.data.results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&model=flux&seed=${Date.now()}`;
    const buf = await fetchBinary(url, 60000);
    res.json({ image: `data:image/jpeg;base64,${buf.toString("base64")}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/video", async (req, res) => {
  const { prompt } = req.body;
  const HF_URL = "https://api-inference.huggingface.co/models/damo-vilab/text-to-video-ms-1.7b";
  try {
    const response = await axios.post(HF_URL, { inputs: prompt }, { responseType: "arraybuffer", timeout: 120000 });
    const buf = Buffer.from(response.data);
    res.json({ video: `data:video/mp4;base64,${buf.toString("base64")}` });
  } catch (err) { res.status(500).json({ error: "Video generation failed" }); }
});

function fetchBinary(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
  });
}

app.post("/send-confirmation", async (req, res) => {
  const { email, name } = req.body;
  const token = crypto.randomBytes(32).toString("hex");
  pendingTokens.set(token, { email, name, expires: Date.now() + 86400000 });
  const confirmLink = `${FRONTEND_URL}?confirm=${token}`;
  const transporter = createTransporter();
  
  if (!transporter) return res.json({ success: true, confirmLink, emailSent: false });

  try {
    await transporter.sendMail({
      from: `"Nova AI 618" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "Confirm your Nova AI 618 account",
      text: `Hello ${name}, confirm here: ${confirmLink}`
    });
    res.json({ success: true, emailSent: true });
  } catch (err) { res.json({ success: true, emailSent: false }); }
});

app.get("/verify-email", (req, res) => {
  const { token } = req.query;
  const data = pendingTokens.get(token);
  if (!data) return res.status(400).send("Invalid token");
  pendingTokens.delete(token);
  res.json({ success: true, email: data.email, name: data.name });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} with Gemma 4 31B`);
});
