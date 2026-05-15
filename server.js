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
// MODÈLES OPENROUTER
// ─────────────────────────────────────────────────────────
const DEFAULT_MODEL = "google/gemma-4-31b-it:free";

const MODEL_MAP = {
  "google/gemma-4-31b-it:free": "google/gemma-4-31b-it:free",
  "openai/gpt-oss-120b":        "openai/gpt-oss-120b"
};

function createTransporter() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
}

// ─────────────────────────────────────────────────────────
// ROOT & DEBUG
// ─────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send("Nova AI 618 Backend — /chat /code /analyze /search /image /video /send-confirmation /verify-email /debug-env");
});

app.get("/debug-env", (req, res) => {
  const or = process.env.OPENROUTER_API_KEY;
  res.json({
    OPENROUTER_API_KEY: or ? `OK (${or.slice(0,8)}...) len=${or.length}` : "ABSENT — REQUIRED",
    TAVILY_API_KEY:     process.env.TAVILY_API_KEY ? "OK" : "ABSENT",
    GMAIL_USER:         process.env.GMAIL_USER ? `OK (${process.env.GMAIL_USER})` : "ABSENT",
    server_time:        new Date().toISOString(),
    models: {
      chat:    `${DEFAULT_MODEL} (4000 tokens)`,
      code:    "poolside/laguna-m.1:free (8000 tokens)",
      analyze: `${DEFAULT_MODEL} vision (images + video)`,
      video:   "HuggingFace damo-vilab/text-to-video-ms-1.7b (free, no key)"
    }
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
  if (!apiKey)
    return res.status(500).json({ error: "OPENROUTER_API_KEY not configured" });

  const selectedModel = MODEL_MAP[model] || DEFAULT_MODEL;

  try {
    console.log(`[/chat] model=${model} → ${selectedModel}`);
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
          "Content-Type": "application/json",
          "HTTP-Referer": FRONTEND_URL,
          "X-Title": "Nova AI 618"
        },
        timeout: 60000 // Timeout augmenté à 60s pour Render
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response from OpenRouter");

    console.log(`[/chat] OK (${selectedModel})`);
    res.json(response.data);

  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.error?.message || err.message;
    console.error(`[/chat] ERROR ${status || "?"}: ${msg}`);
    if (status === 429) return res.status(429).json({ rate_limited: true });
    res.status(500).json({ error: "Chat error: " + msg });
  }
});

// ─────────────────────────────────────────────────────────
// /code — Laguna M.1
// ─────────────────────────────────────────────────────────
app.post("/code", async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: "messages required" });

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey)
    return res.status(500).json({ error: "OPENROUTER_API_KEY not configured", fix: "Add in Render > Environment" });

  try {
    console.log("[/code] Laguna M.1...");
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "poolside/laguna-m.1:free",
        messages,
        temperature: 0.2,
        max_tokens: 8000
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": FRONTEND_URL,
          "X-Title": "Nova AI 618"
        },
        timeout: 90000 // Le code peut être long à générer
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response from Laguna M.1");

    console.log("[/code] OK");
    res.json(response.data);

  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.error?.message || err.message;
    console.error(`[/code] ERROR ${status || "?"}: ${msg}`);
    if (status === 401) return res.status(401).json({ error: "API key invalid" });
    res.status(500).json({ error: "Code error: " + msg });
  }
});

// ─────────────────────────────────────────────────────────
// /analyze — Multimodal Vision via Gemma 4 31B
// ─────────────────────────────────────────────────────────
app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;
  if (!image) return res.status(400).json({ error: "image required" });

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey)
    return res.status(500).json({ error: "OPENROUTER_API_KEY not configured" });

  const prompt = question || "Analyze this image in detail. Describe what you see, key elements, colors, context, and anything relevant.";

  const isVideo = image.startsWith("data:video/");
  const isGif   = image.startsWith("data:image/gif");

  let content;
  if (isVideo) {
    content = [
      { type: "video_url", video_url: { url: image } },
      { type: "text",      text: question || "Analyze this video in detail. Describe what happens, key elements, motion, colors, context, and anything relevant." }
    ];
  } else {
    content = [
      { type: "image_url", image_url: { url: image, detail: "auto" } },
      { type: "text",      text: prompt }
    ];
  }

  try {
    console.log(`[/analyze] Gemma 4 31B vision — ${isVideo ? "VIDEO" : isGif ? "GIF" : "IMAGE"}...`);
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: DEFAULT_MODEL,
        messages: [{ role: "user", content }],
        max_tokens: 1500,
        temperature: 0.5
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": FRONTEND_URL,
          "X-Title": "Nova AI 618"
        },
        timeout: 60000 // Timeout augmenté pour l'upload d'images
      }
    );

    const reply = response.data?.choices?.[0]?.message?.content;
    if (!reply) throw new Error("Empty response from vision model");

    console.log("[/analyze] OK");
    res.json({ choices: [{ message: { content: reply } }] });

  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error(`[/analyze] ERROR: ${msg}`);
    res.status(500).json({ error: "Analysis error: " + msg });
  }
});

// ─────────────────────────────────────────────────────────
// /search — Tavily
// ─────────────────────────────────────────────────────────
app.post("/search", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });
  if (!process.env.TAVILY_API_KEY)
    return res.status(500).json({ error: "TAVILY_API_KEY not configured" });

  try {
    const r = await axios.post(
      "https://api.tavily.com/search",
      { api_key: process.env.TAVILY_API_KEY, query: query.trim(), search_depth: "basic", max_results: 5, include_answer: true },
      { timeout: 15000 }
    );
    const data = r.data;
    res.json({
      answer: data.answer || "",
      context: (data.results || []).map((r, i) =>
        `[${i + 1}] ${r.title}\n${(r.content || "").slice(0, 450)}\nSource: ${r.url}`
      ).join("\n\n"),
      sources: (data.results || []).map(r => ({ title: r.title, url: r.url }))
    });
  } catch (err) {
    res.status(500).json({ error: "Search failed: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// /image — Pollinations
// ─────────────────────────────────────────────────────────
app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&enhance=true&model=flux&seed=${Date.now()}`;
    const buf = await fetchBinary(url, 60000);
    res.json({ image: `data:image/jpeg;base64,${buf.toString("base64")}` });
  } catch (err) {
    res.status(500).json({ error: "Image generation failed: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// /video — HuggingFace text-to-video
// ─────────────────────────────────────────────────────────
app.post("/video", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  const cleanPrompt = prompt.slice(0, 200).trim();
  console.log(`[/video] "${cleanPrompt.slice(0, 60)}..."`);

  const HF_URL = "https://api-inference.huggingface.co/models/damo-vilab/text-to-video-ms-1.7b";
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`[/video] Attempt ${attempt}/${MAX_ATTEMPTS}...`);
      const response = await axios.post(
        HF_URL,
        { inputs: cleanPrompt },
        {
          headers: { "Content-Type": "application/json", "Accept": "video/mp4,*/*" },
          responseType: "arraybuffer",
          timeout: 120000
        }
      );

      const buf = Buffer.from(response.data);
      if (buf.length < 1000) throw new Error(`Response too small (${buf.length}B)`);

      let mime = "video/mp4";
      if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) mime = "image/gif";
      else if (buf[0] === 0xff && buf[1] === 0xd8) mime = "image/jpeg";
      else if (buf[0] === 0x89 && buf[1] === 0x50) mime = "image/png";

      console.log(`[/video] OK attempt ${attempt}: ${(buf.length / 1024).toFixed(0)}KB, mime=${mime}`);
      return res.json({
        video:   `data:${mime};base64,${buf.toString("base64")}`,
        mime,
        isGif:   mime === "image/gif",
        isVideo: mime === "video/mp4"
      });

    } catch (err) {
      const status = err.response?.status;
      console.warn(`[/video] Attempt ${attempt} failed: HTTP ${status || "?"} — ${err.message}`);

      if (status === 503 && attempt < MAX_ATTEMPTS) {
        const wait = attempt * 15000;
        console.log(`[/video] Model loading, waiting ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (status === 429)
        return res.status(429).json({ error: "Video rate limit. Please wait a few minutes." });
      break;
    }
  }

  res.status(500).json({
    error: "Video generation failed. The AI model may be warming up — please try again in 30 seconds."
  });
});

// ─────────────────────────────────────────────────────────
// fetchBinary helper
// ─────────────────────────────────────────────────────────
function fetchBinary(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const timer = setTimeout(() => reject(new Error(`Timeout ${timeoutMs}ms`)), timeoutMs);
    const req = lib.get(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "*/*" } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        clearTimeout(timer);
        return fetchBinary(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      if (res.statusCode >= 400) { clearTimeout(timer); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
      res.on("error", e => { clearTimeout(timer); reject(e); });
    });
    req.on("error", e => { clearTimeout(timer); reject(e); });
  });
}

// ─────────────────────────────────────────────────────────
// /send-confirmation & /verify-email
// ─────────────────────────────────────────────────────────
app.post("/send-confirmation", async (req, res) => {
  const { email, name } = req.body;
  if (!email || !name) return res.status(400).json({ success: false, error: "Missing fields" });

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
.sub{color:#7a7a9a;font-size:13px;margin-top:6px}
.body{padding:32px}.greet{font-size:17px;font-weight:600;margin-bottom:12px}
.txt{color:#7a7a9a;font-size:14px;line-height:1.7;margin-bottom:28px}
.btn-wrap{text-align:center;margin:24px 0}
.btn{display:inline-block;background:#7c6aff;color:#fff!important;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:700;font-size:15px}
.expire{background:rgba(255,140,0,.08);border:1px solid rgba(255,140,0,.2);border-radius:8px;padding:10px 14px;font-size:12px;color:rgba(255,140,0,.9);margin-top:20px}
.foot{padding:18px 32px;border-top:1px solid rgba(255,255,255,.05);font-size:11px;color:#3e3e55;text-align:center}
</style></head><body><div class="wrap">
<div class="head"><div class="logo">NOVA <em>AI 618</em></div><div class="sub">Created by Sixte · Intelligence redefined</div></div>
<div class="body"><div class="greet">Hello ${name} 👋</div>
<div class="txt">Welcome to <strong style="color:#ebebf2">Nova AI 618</strong>!<br>Click below to activate your account.</div>
<div class="btn-wrap"><a href="${confirmLink}" class="btn">Confirm my account</a></div>
<div class="expire">This link expires in <strong>24 hours</strong>.</div></div>
<div class="foot">Nova AI 618 · Created by Sixte Leinekugel<br>Didn't sign up? Ignore this email.</div>
</div></body></html>`,
      text: `Hello ${name},\n\nActivate: ${confirmLink}\n\nExpires in 24h.\n— Nova AI 618`
    });
    res.json({ success: true, confirmLink, emailSent: true });
  } catch (err) {
    res.json({ success: true, confirmLink, emailSent: false, emailError: err.message });
  }
});

app.get("/verify-email", (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ success: false, error: "No token" });
  const data = pendingTokens.get(token);
  if (!data) return res.status(400).json({ success: false, error: "Invalid token" });
  if (Date.now() > data.expires) {
    pendingTokens.delete(token);
    return res.status(400).json({ success: false, error: "Token expired" });
  }
  pendingTokens.delete(token);
  res.json({ success: true, email: data.email, name: data.name });
});

// ─────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const or = process.env.OPENROUTER_API_KEY;
  console.log(`\n🚀 Nova AI 618 Backend — port ${PORT}`);
  console.log(`   OPENROUTER_API_KEY : ${or ? "✅ OK " + or.slice(0,8) + "..." : "❌ ABSENT"}`);
  console.log(`   TAVILY_API_KEY     : ${process.env.TAVILY_API_KEY ? "✅ OK" : "❌ ABSENT"}`);
  console.log(`   GMAIL_USER         : ${process.env.GMAIL_USER ? "✅ " + process.env.GMAIL_USER : "⚠️  ABSENT"}`);
  console.log(`\n   /chat    → ${DEFAULT_MODEL}  (4 000 tokens)`);
  console.log(`   /code    → poolside/laguna-m.1:free    (8 000 tokens)`);
  console.log(`   /analyze → ${DEFAULT_MODEL}  (vision: images + vidéos)`);
  console.log(`   /image   → Pollinations flux           (no key)`);
  console.log(`   /video   → HuggingFace text-to-video   (no key, retry 503)`);
  console.log(`   /search  → Tavily\n`);
});
