import express from "express";
import cors from "cors";
import axios from "axios";
import https from "https";
import http from "http";
import crypto from "crypto";
import nodemailer from "nodemailer";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" })); // Augmenté pour le transit des médias

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
    HF_TOKEN: process.env.HF_TOKEN ? "OK (Requis pour Vidéo)" : "ABSENT",
    TAVILY_API_KEY:     process.env.TAVILY_API_KEY ? "OK" : "ABSENT",
    GMAIL_USER:         process.env.GMAIL_USER ? `OK (${process.env.GMAIL_USER})` : "ABSENT",
    server_time:        new Date().toISOString(),
    models: {
      chat:    "openai/gpt-oss-120b",
      code:    "poolside/laguna-m.1:free",
      video:   "HuggingFace damo-vilab (Auth active)"
    }
  });
});

// ─────────────────────────────────────────────────────────
// /chat — gpt-oss-120b, 4000 tokens
// ─────────────────────────────────────────────────────────
app.post("/chat", async (req, res) => {
  const { messages, model, temperature } = req.body;
  if (!messages || !Array.isArray(messages))
    return res.status(400).json({ error: "messages array required" });

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey)
    return res.status(500).json({ error: "OPENROUTER_API_KEY not configured" });

  const selectedModel = MODEL_MAP[model] || "openai/gpt-oss-120b";

  try {
    console.log(`[/chat] ${model} → ${selectedModel}`);
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      { model: selectedModel, messages, temperature: temperature ?? 0.7, max_tokens: 4000 },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": FRONTEND_URL,
          "X-Title": "Nova AI 618"
        },
        timeout: 40000
      }
    );
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status;
    if (status === 429) return res.status(429).json({ rate_limited: true });
    res.status(500).json({ error: "Chat error: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// /code — Laguna M.1, 8000 tokens
// ─────────────────────────────────────────────────────────
app.post("/code", async (req, res) => {
  const { messages } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  try {
    console.log("[/code] Laguna M.1...");
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      { model: "poolside/laguna-m.1:free", messages, temperature: 0.2, max_tokens: 8000 },
      {
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        timeout: 90000
      }
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
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: image, detail: "auto" } },
            { type: "text", text: prompt }
          ]
        }],
        max_tokens: 1500
      },
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, timeout: 30000 }
    );
    res.json({ choices: [{ message: { content: response.data?.choices?.[0]?.message?.content } }] });
  } catch (err) {
    res.status(500).json({ error: "Analysis error: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// /search — Tavily
// ─────────────────────────────────────────────────────────
app.post("/search", async (req, res) => {
  const { query } = req.body;
  try {
    const r = await axios.post(
      "https://api.tavily.com/search",
      { api_key: process.env.TAVILY_API_KEY, query: query.trim(), search_depth: "basic", max_results: 5, include_answer: true },
      { timeout: 15000 }
    );
    res.json({
      answer: r.data.answer || "",
      context: (r.data.results || []).map((res, i) => `[${i + 1}] ${res.title}\n${res.content}\nSource: ${res.url}`).join("\n\n"),
      sources: (r.data.results || []).map(res => ({ title: res.title, url: res.url }))
    });
  } catch (err) {
    res.status(500).json({ error: "Search failed: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// /image — Pollinations flux
// ─────────────────────────────────────────────────────────
app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&enhance=true&model=flux&seed=${Date.now()}`;
    const buf = await fetchBinary(url, 60000);
    res.json({ image: `data:image/jpeg;base64,${buf.toString("base64")}` });
  } catch (err) {
    res.status(500).json({ error: "Image generation failed: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// /video — HuggingFace (CORRIGÉ AVEC AUTH)
// ─────────────────────────────────────────────────────────
app.post("/video", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  const hfToken = process.env.HF_TOKEN?.trim();
  if (!hfToken) return res.status(500).json({ error: "HF_TOKEN absent sur le serveur." });

  const HF_URL = "https://api-inference.huggingface.co/models/damo-vilab/text-to-video-ms-1.7b";
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`[/video] Attempt ${attempt}/${MAX_ATTEMPTS}...`);
      const response = await axios.post(
        HF_URL,
        { inputs: prompt.slice(0, 200) },
        {
          headers: { 
            "Authorization": `Bearer ${hfToken}`,
            "Content-Type": "application/json", 
            "Accept": "video/mp4,*/*" 
          },
          responseType: "arraybuffer",
          timeout: 150000 
        }
      );

      const buf = Buffer.from(response.data);
      if (buf.length < 1000) throw new Error("Réponse trop petite");

      let mime = "video/mp4";
      if (buf[0] === 0x47 && buf[1] === 0x49) mime = "image/gif";

      return res.json({
        video: `data:${mime};base64,${buf.toString("base64")}`,
        mime,
        isVideo: mime === "video/mp4"
      });

    } catch (err) {
      const status = err.response?.status;
      if (status === 503 && attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, attempt * 20000));
        continue;
      }
      break;
    }
  }
  res.status(500).json({ error: "Video generation failed. Try again in 30s." });
});

// ─────────────────────────────────────────────────────────
// HELPERS & AUTH SYSTEM (E-mail Template Inclus)
// ─────────────────────────────────────────────────────────
function fetchBinary(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const timer = setTimeout(() => reject(new Error("Timeout")), timeoutMs);
    const req = lib.get(url, (res) => {
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

app.post("/send-confirmation", async (req, res) => {
  const { email, name } = req.body;
  const token = crypto.randomBytes(32).toString("hex");
  pendingTokens.set(token, { email: email.toLowerCase().trim(), name, expires: Date.now() + 86400000 });
  const confirmLink = `${FRONTEND_URL}?confirm=${token}`;
  const transporter = createTransporter();

  if (!transporter) return res.json({ success: true, confirmLink, emailSent: false });

  try {
    await transporter.sendMail({
      from: `"Nova AI 618" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "Confirm your Nova AI 618 account",
      html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
        body{font-family:'Segoe UI',sans-serif;background:#050608;color:#ebebf2;margin:0;padding:0}
        .wrap{max-width:520px;margin:40px auto;background:#0b0c12;border:1px solid rgba(255,255,255,.08);border-radius:18px;overflow:hidden}
        .head{background:linear-gradient(135deg,#0d0a1e,#070512);padding:36px 32px;text-align:center;border-bottom:1px solid rgba(124,106,255,.2)}
        .logo{font-size:26px;font-weight:800}.logo em{color:#7c6aff;font-style:normal}
        .body{padding:32px}.btn-wrap{text-align:center;margin:24px 0}
        .btn{display:inline-block;background:#7c6aff;color:#fff!important;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:700}
        .foot{padding:18px 32px;font-size:11px;color:#3e3e55;text-align:center}
        </style></head><body><div class="wrap">
        <div class="head"><div class="logo">NOVA <em>AI 618</em></div></div>
        <div class="body"><div class="greet">Hello ${name} 👋</div>
        <p>Click below to activate your account.</p>
        <div class="btn-wrap"><a href="${confirmLink}" class="btn">Confirm my account</a></div></div>
        <div class="foot">Nova AI 618 · Created by Sixte Leinekugel</div></div></body></html>`
    });
    res.json({ success: true, confirmLink, emailSent: true });
  } catch (err) {
    res.json({ success: true, confirmLink, emailSent: false });
  }
});

app.get("/verify-email", (req, res) => {
  const { token } = req.query;
  const data = pendingTokens.get(token);
  if (!data || Date.now() > data.expires) return res.status(400).json({ error: "Invalid/Expired" });
  pendingTokens.delete(token);
  res.json({ success: true, email: data.email, name: data.name });
});

app.listen(PORT, () => {
  console.log(`🚀 Nova AI 618 Backend — port ${PORT}`);
});
