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
// OPENROUTER MODEL MAP
// gpt-4o-mini is the default (better than gpt-oss-120b free tier)
// ─────────────────────────────────────────────────────────
const MODEL_MAP = {
  "openai/gpt-oss-120b":     "openai/gpt-4o-mini",
  "llama-3.3-70b-versatile": "meta-llama/llama-3.3-70b-instruct:free",
  "llama-3.1-8b-instant":    "meta-llama/llama-3.1-8b-instruct:free"
};

// ─────────────────────────────────────────────────────────
// NODEMAILER
// ─────────────────────────────────────────────────────────
function createTransporter() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
}

// ─────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send("Nova AI 618 Backend — /chat /code /analyze /search /image /video /send-confirmation /verify-email /debug-env");
});

// ─────────────────────────────────────────────────────────
// DEBUG ENV
// ─────────────────────────────────────────────────────────
app.get("/debug-env", (req, res) => {
  const or = process.env.OPENROUTER_API_KEY;
  res.json({
    OPENROUTER_API_KEY: or ? `OK (${or.slice(0,8)}...) len=${or.length}` : "ABSENT — REQUIRED",
    TAVILY_API_KEY:     process.env.TAVILY_API_KEY ? `OK` : "ABSENT",
    GMAIL_USER:         process.env.GMAIL_USER ? `OK (${process.env.GMAIL_USER})` : "ABSENT",
    NODE_ENV:           process.env.NODE_ENV || "development",
    server_time:        new Date().toISOString(),
    models: {
      chat:    "openai/gpt-4o-mini (via OpenRouter)",
      code:    "poolside/laguna-m.1:free (via OpenRouter)",
      analyze: "openai/gpt-4o-mini vision (via OpenRouter)",
      video:   "Pollinations animatediff GIF (free, no key)"
    }
  });
});

// ─────────────────────────────────────────────────────────
// /chat — ALL models via OpenRouter, gpt-4o-mini as default
// max_tokens: 4000 for standard models
// ─────────────────────────────────────────────────────────
app.post("/chat", async (req, res) => {
  const { messages, model, temperature } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array required" });
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return res.status(500).json({ error: "OPENROUTER_API_KEY not configured on server" });
  }

  const selectedModel = MODEL_MAP[model] || "openai/gpt-4o-mini";

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
        timeout: 40000
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response from OpenRouter");

    console.log(`[/chat] SUCCESS (${selectedModel})`);
    res.json(response.data);

  } catch (err) {
    const status = err.response?.status;
    const errMsg = err.response?.data?.error?.message || err.message;
    console.error(`[/chat] ERROR HTTP ${status || "?"}: ${errMsg}`);
    if (status === 429) return res.status(429).json({ rate_limited: true });
    res.status(500).json({ error: "Chat error: " + errMsg });
  }
});

// ─────────────────────────────────────────────────────────
// /code — Laguna M.1 via OpenRouter
// max_tokens: 8000 for code generation
// ─────────────────────────────────────────────────────────
app.post("/code", async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: "messages required" });

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return res.status(500).json({
      error: "OPENROUTER_API_KEY not configured",
      fix: "Add OPENROUTER_API_KEY in Render > Environment"
    });
  }

  try {
    console.log("[/code] Calling Laguna M.1...");
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
        timeout: 90000
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response from Laguna M.1");

    console.log("[/code] SUCCESS");
    res.json(response.data);

  } catch (err) {
    const status = err.response?.status;
    const errMsg = err.response?.data?.error?.message || err.message;
    console.error(`[/code] ERROR HTTP ${status || "?"}: ${errMsg}`);
    if (status === 401) return res.status(401).json({ error: "OpenRouter API key invalid (401)" });
    res.status(500).json({ error: "Code mode error: " + errMsg });
  }
});

// ─────────────────────────────────────────────────────────
// /analyze — Photo analysis via OpenRouter vision (GPT-4o-mini)
// ─────────────────────────────────────────────────────────
app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;
  if (!image) return res.status(400).json({ error: "image required" });

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return res.status(500).json({ error: "OPENROUTER_API_KEY not configured" });
  }

  const prompt = question || "Analyze this image in detail. Describe what you see, key elements, colors, context, and anything relevant.";

  try {
    console.log("[/analyze] Calling GPT-4o-mini vision via OpenRouter...");
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: image, detail: "auto" } },
              { type: "text", text: prompt }
            ]
          }
        ],
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
        timeout: 30000
      }
    );

    const reply = response.data?.choices?.[0]?.message?.content;
    if (!reply) throw new Error("Empty response from vision model");

    console.log("[/analyze] SUCCESS");
    res.json({ choices: [{ message: { content: reply } }] });

  } catch (err) {
    const status = err.response?.status;
    const errMsg = err.response?.data?.error?.message || err.message;
    console.error(`[/analyze] ERROR HTTP ${status || "?"}: ${errMsg}`);
    res.status(500).json({ error: "Photo analysis error: " + errMsg });
  }
});

// ─────────────────────────────────────────────────────────
// /search — Tavily web search
// ─────────────────────────────────────────────────────────
app.post("/search", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });

  if (!process.env.TAVILY_API_KEY) {
    return res.status(500).json({ error: "TAVILY_API_KEY not configured" });
  }

  try {
    const r = await axios.post(
      "https://api.tavily.com/search",
      {
        api_key: process.env.TAVILY_API_KEY,
        query: query.trim(),
        search_depth: "basic",
        max_results: 5,
        include_answer: true
      },
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
    console.error("[/search] Tavily error:", err.message);
    res.status(500).json({ error: "Search failed: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// /image — Pollinations image generation (no API key)
// ─────────────────────────────────────────────────────────
app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&enhance=true&model=flux&seed=${Date.now()}`;
    console.log(`[/image] Fetching Pollinations image...`);

    const buf = await fetchBinary(url, 60000);
    console.log(`[/image] SUCCESS (${buf.length} bytes)`);
    res.json({ image: `data:image/jpeg;base64,${buf.toString("base64")}` });

  } catch (err) {
    console.error("[/image] Error:", err.message);
    res.status(500).json({ error: "Image generation failed: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// /video — Animated GIF via Pollinations animatediff
// FIX: Use the correct Pollinations endpoint that actually works
// Returns a base64 GIF (animated)
// ─────────────────────────────────────────────────────────
app.post("/video", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  // Clean prompt for video/animation
  const cleanPrompt = prompt
    .slice(0, 180)
    .replace(/[^\w\s,.\-!?]/g, " ")
    .trim();

  console.log(`[/video] Generating animated GIF for: "${cleanPrompt.slice(0,60)}..."`);

  // Strategy: try multiple Pollinations video/animation endpoints
  const attempts = [
    // Attempt 1: Pollinations animatediff model (GIF)
    {
      url: `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt + ", cinematic animation, motion, dynamic")}?model=animatediff&width=512&height=288&nologo=true&seed=${Date.now()}`,
      type: "image/gif",
      label: "animatediff"
    },
    // Attempt 2: Fallback — use turbo model as static (reliable)
    {
      url: `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt + ", cinematic, dramatic lighting, photorealistic")}?width=896&height=512&nologo=true&enhance=true&model=flux&seed=${Date.now()}`,
      type: "image/jpeg",
      label: "flux-fallback"
    }
  ];

  for (const attempt of attempts) {
    try {
      console.log(`[/video] Trying ${attempt.label}: ${attempt.url.slice(0,80)}...`);
      const buf = await fetchBinary(attempt.url, 120000);

      if (buf.length < 500) {
        console.warn(`[/video] ${attempt.label} response too small (${buf.length} bytes), trying next...`);
        continue;
      }

      // Detect actual content type from magic bytes
      let mimeType = attempt.type;
      if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
        mimeType = "image/gif";
      } else if (buf[0] === 0xff && buf[1] === 0xd8) {
        mimeType = "image/jpeg";
      } else if (buf[0] === 0x89 && buf[1] === 0x50) {
        mimeType = "image/png";
      } else if (buf[0] === 0x00 && buf[4] === 0x66) {
        mimeType = "video/mp4";
      }

      const isVideo = mimeType === "video/mp4";
      const isGif   = mimeType === "image/gif";
      const isImage = mimeType.startsWith("image/") && !isGif;

      console.log(`[/video] ${attempt.label} SUCCESS: ${buf.length} bytes, type=${mimeType}`);

      return res.json({
        video: `data:${mimeType};base64,${buf.toString("base64")}`,
        mime:  mimeType,
        isGif,
        isVideo,
        isImage,
        model: attempt.label
      });

    } catch (err) {
      console.error(`[/video] ${attempt.label} failed:`, err.message);
      // continue to next attempt
    }
  }

  // All attempts failed
  res.status(500).json({
    error: "Video/animation generation failed. Pollinations may be temporarily unavailable. Please try again in a few seconds."
  });
});

// ─────────────────────────────────────────────────────────
// fetchBinary — robust HTTP/HTTPS fetch returning a Buffer
// ─────────────────────────────────────────────────────────
function fetchBinary(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const timer = setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);

    const req = lib.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NovaAI/1.0)",
        "Accept": "*/*"
      }
    }, (response) => {
      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        clearTimeout(timer);
        return fetchBinary(response.headers.location, timeoutMs).then(resolve).catch(reject);
      }

      if (response.statusCode && response.statusCode >= 400) {
        clearTimeout(timer);
        return reject(new Error(`HTTP ${response.statusCode}`));
      }

      const chunks = [];
      response.on("data", c => chunks.push(c));
      response.on("end", () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks));
      });
      response.on("error", e => { clearTimeout(timer); reject(e); });
    });

    req.on("error", e => { clearTimeout(timer); reject(e); });
  });
}

// ─────────────────────────────────────────────────────────
// /send-confirmation
// ─────────────────────────────────────────────────────────
app.post("/send-confirmation", async (req, res) => {
  const { email, name } = req.body;
  if (!email || !name) {
    return res.status(400).json({ success: false, error: "Missing email or name" });
  }

  const token = crypto.randomBytes(32).toString("hex");
  pendingTokens.set(token, {
    email: email.toLowerCase().trim(),
    name,
    expires: Date.now() + 24 * 60 * 60 * 1000
  });
  const confirmLink = `${FRONTEND_URL}?confirm=${token}`;
  console.log(`[/send-confirmation] Token created for ${email}`);

  const transporter = createTransporter();
  if (!transporter) {
    return res.json({ success: true, confirmLink, emailSent: false });
  }

  try {
    await transporter.sendMail({
      from: `"Nova AI 618" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "Confirm your Nova AI 618 account",
      html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{font-family:'Segoe UI',Arial,sans-serif;background:#050608;color:#ebebf2;margin:0;padding:0}
.wrap{max-width:520px;margin:40px auto;background:#0b0c12;border:1px solid rgba(255,255,255,0.08);border-radius:18px;overflow:hidden}
.head{background:linear-gradient(135deg,#0d0a1e,#070512);padding:36px 32px;text-align:center;border-bottom:1px solid rgba(124,106,255,0.2)}
.logo{font-size:26px;font-weight:800;color:#ebebf2}.logo em{color:#7c6aff;font-style:normal}
.sub{color:#7a7a9a;font-size:13px;margin-top:6px}
.body{padding:32px}.greet{font-size:17px;font-weight:600;margin-bottom:12px}
.txt{color:#7a7a9a;font-size:14px;line-height:1.7;margin-bottom:28px}
.btn-wrap{text-align:center;margin:24px 0}
.btn{display:inline-block;background:#7c6aff;color:#fff !important;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:700;font-size:15px}
.expire{background:rgba(255,140,0,0.08);border:1px solid rgba(255,140,0,0.2);border-radius:8px;padding:10px 14px;font-size:12px;color:rgba(255,140,0,0.9);margin-top:20px}
.linkbox{margin-top:16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px 14px;font-size:11px;color:#3e3e55;word-break:break-all}
.linkbox a{color:#7c6aff}
.foot{padding:18px 32px;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:#3e3e55;text-align:center}
</style></head><body><div class="wrap">
<div class="head"><div class="logo">NOVA <em>AI 618</em></div><div class="sub">Created by Sixte · Intelligence redefined</div></div>
<div class="body"><div class="greet">Hello ${name} 👋</div>
<div class="txt">Welcome to <strong style="color:#ebebf2">Nova AI 618</strong>!<br>Click below to confirm your account.</div>
<div class="btn-wrap"><a href="${confirmLink}" class="btn">Confirm my account</a></div>
<div class="expire">This link expires in <strong>24 hours</strong>.</div>
<div class="linkbox">If the button doesn't work:<br><a href="${confirmLink}">${confirmLink}</a></div>
</div><div class="foot">Nova AI 618 · Created by Sixte Leinekugel<br>If you didn't create an account, ignore this email.</div>
</div></body></html>`,
      text: `Hello ${name},\n\nConfirm your Nova AI 618 account:\n${confirmLink}\n\nExpires in 24h.\n— Nova AI 618`
    });
    console.log(`[/send-confirmation] Email sent to ${email}`);
    res.json({ success: true, confirmLink, emailSent: true });
  } catch (err) {
    console.error("[/send-confirmation] Nodemailer error:", err.message);
    res.json({ success: true, confirmLink, emailSent: false, emailError: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// /verify-email
// ─────────────────────────────────────────────────────────
app.get("/verify-email", (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ success: false, error: "No token" });
  const data = pendingTokens.get(token);
  if (!data) return res.status(400).json({ success: false, error: "Invalid or already used token" });
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
  console.log(`   OPENROUTER_API_KEY : ${or ? "✅ OK " + or.slice(0,8) + "..." : "❌ ABSENT — REQUIRED"}`);
  console.log(`   TAVILY_API_KEY     : ${process.env.TAVILY_API_KEY ? "✅ OK" : "❌ ABSENT"}`);
  console.log(`   GMAIL_USER         : ${process.env.GMAIL_USER ? "✅ " + process.env.GMAIL_USER : "⚠️  ABSENT"}`);
  console.log(`\n   /chat    → openai/gpt-4o-mini (4000 tokens)`);
  console.log(`   /code    → poolside/laguna-m.1:free (8000 tokens)`);
  console.log(`   /analyze → openai/gpt-4o-mini vision`);
  console.log(`   /image   → Pollinations flux`);
  console.log(`   /video   → Pollinations animatediff GIF (with fallback)`);
  console.log(`   /search  → Tavily\n`);
});
