import express from "express";
import cors from "cors";
import axios from "axios";
import https from "https";
import http from "http";
import crypto from "crypto";
import nodemailer from "nodemailer";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" })); // Augmenté pour supporter les transferts d'images/vidéos

const PORT = process.env.PORT || 10000;
const FRONTEND_URL = "https://sixteleinekugel-commits.github.io/novaAI-chat";
const pendingTokens = new Map();

// ─────────────────────────────────────────────────────────
// OPENROUTER MODEL MAP
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

app.get("/", (req, res) => {
  res.send("Nova AI 618 Backend — /chat /code /analyze /search /image /video /send-confirmation /verify-email /debug-env");
});

app.get("/debug-env", (req, res) => {
  const or = process.env.OPENROUTER_API_KEY;
  res.json({
    OPENROUTER_API_KEY: or ? `OK (${or.slice(0,8)}...)` : "ABSENT",
    TAVILY_API_KEY:     process.env.TAVILY_API_KEY ? "OK" : "ABSENT",
    GMAIL_USER:         process.env.GMAIL_USER ? `OK (${process.env.GMAIL_USER})` : "ABSENT",
    server_time:        new Date().toISOString(),
    models: {
      chat:    "openai/gpt-oss-120b",
      code:    "poolside/laguna-m.1:free",
      image:   "stabilityai/stable-diffusion-xl:free (via OpenRouter)",
      video:   "HuggingFace damo-vilab"
    }
  });
});

// ─────────────────────────────────────────────────────────
// /chat — gpt-oss-120b
// ─────────────────────────────────────────────────────────
app.post("/chat", async (req, res) => {
  const { messages, model, temperature } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return res.status(500).json({ error: "OPENROUTER_API_KEY not configured" });

  const selectedModel = MODEL_MAP[model] || "openai/gpt-oss-120b";
  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      { model: selectedModel, messages, temperature: temperature ?? 0.7, max_tokens: 4000 },
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, timeout: 40000 }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: "Chat error: " + (err.response?.data?.error?.message || err.message) });
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
      { model: "poolside/laguna-m.1:free", messages, temperature: 0.2, max_tokens: 8000 },
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, timeout: 90000 }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: "Code error: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// /analyze — gpt-oss-120b vision
// ─────────────────────────────────────────────────────────
app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const prompt = question || "Analyze this image in detail.";
  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-oss-120b",
        messages: [{ role: "user", content: [
          { type: "image_url", image_url: { url: image } },
          { type: "text", text: prompt }
        ]}]
      },
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, timeout: 30000 }
    );
    res.json({ choices: [{ message: { content: response.data?.choices?.[0]?.message?.content } }] });
  } catch (err) {
    res.status(500).json({ error: "Analysis error: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// /image — Stable Diffusion XL 1.0 (Free via OpenRouter)
// ─────────────────────────────────────────────────────────
app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return res.status(500).json({ error: "OPENROUTER_API_KEY required for SDXL" });

  try {
    console.log(`[/image] SDXL generating: "${prompt.slice(0, 50)}..."`);
    
    // 1. Demander la génération à OpenRouter
    const response = await axios.post(
      "https://openrouter.ai/api/v1/images/generations",
      {
        model: "stabilityai/stable-diffusion-xl:free",
        prompt: prompt,
        response_format: "url" // SDXL sur OpenRouter retourne une URL
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": FRONTEND_URL,
          "X-Title": "Nova AI 618"
        },
        timeout: 60000
      }
    );

    const imageUrl = response.data?.data?.[0]?.url;
    if (!imageUrl) throw new Error("No image URL returned from OpenRouter");

    // 2. Télécharger l'image pour la renvoyer en Base64 (comme Pollinations)
    const buf = await fetchBinary(imageUrl, 30000);
    console.log("[/image] SDXL OK, converted to base64");
    
    res.json({ image: `data:image/jpeg;base64,${buf.toString("base64")}` });

  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.message;
    console.error(`[/image] ERROR: ${errorMsg}`);
    res.status(500).json({ error: "SDXL generation failed: " + errorMsg });
  }
});

// ─────────────────────────────────────────────────────────
// /video — HuggingFace
// ─────────────────────────────────────────────────────────
app.post("/video", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  const HF_URL = "https://api-inference.huggingface.co/models/damo-vilab/text-to-video-ms-1.7b";
  try {
    const response = await axios.post(
      HF_URL, { inputs: prompt },
      { responseType: "arraybuffer", timeout: 120000 }
    );
    const buf = Buffer.from(response.data);
    let mime = "video/mp4";
    if (buf[0] === 0x47 && buf[1] === 0x49) mime = "image/gif";
    res.json({ video: `data:${mime};base64,${buf.toString("base64")}`, mime });
  } catch (err) {
    res.status(500).json({ error: "Video generation failed" });
  }
});

// ─────────────────────────────────────────────────────────
// /search — Tavily
// ─────────────────────────────────────────────────────────
app.post("/search", async (req, res) => {
  const { query } = req.body;
  try {
    const r = await axios.post("https://api.tavily.com/search", {
      api_key: process.env.TAVILY_API_KEY, query, search_depth: "basic", include_answer: true
    });
    res.json({
      answer: r.data.answer || "",
      context: r.data.results.map(res => `[${res.title}]\n${res.content}\nSource: ${res.url}`).join("\n\n"),
      sources: r.data.results
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────
function fetchBinary(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const timer = setTimeout(() => reject(new Error("Timeout")), timeoutMs);
    const req = lib.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if ([301,302,307,308].includes(res.statusCode)) {
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
// /send-confirmation
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
      html: `<h1>Hello ${name}</h1><p>Click <a href="${confirmLink}">here</a> to confirm.</p>`
    });
    res.json({ success: true, confirmLink, emailSent: true });
  } catch (err) { res.json({ success: true, confirmLink, emailSent: false }); }
});

app.get("/verify-email", (req, res) => {
  const { token } = req.query;
  const data = pendingTokens.get(token);
  if (!data || Date.now() > data.expires) return res.status(400).json({ error: "Invalid/Expired" });
  pendingTokens.delete(token);
  res.json({ success: true, email: data.email, name: data.name });
});

app.listen(PORT, () => console.log(`🚀 Nova AI 618 Ready on port ${PORT}`));
