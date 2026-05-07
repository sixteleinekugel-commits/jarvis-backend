import express from "express";
import cors from "cors";
import axios from "axios";
import https from "https";
import crypto from "crypto";
import nodemailer from "nodemailer";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 10000;
const FRONTEND_URL = "https://sixteleinekugel-commits.github.io/novaAI-chat";

// Tokens de confirmation en mémoire
const pendingTokens = new Map();

const VISION_MODELS = [
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "llava-v1.5-7b-4096-preview",
  "llama-3.2-11b-vision-preview",
  "llama-3.2-90b-vision-preview"
];

app.get("/", (req, res) => {
  res.json({ status: "Nova AI Server OK 🚀", routes: ["/chat", "/image", "/analyze", "/search", "/send-confirmation", "/verify-email"] });
});

// ── CHAT ─────────────────────────────────────────────────────
app.post("/chat", async (req, res) => {
  const { messages, model } = req.body;
  console.log("CHAT — model requested:", model);
  console.log("GROQ_API_KEY =", process.env.GROQ_API_KEY ? "OK" : "MISSING");

  if (!messages || !messages.length) {
    return res.json({ choices: [{ message: { content: "No message received" } }] });
  }

  const VALID_MODELS = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
  const selectedModel = VALID_MODELS.includes(model) ? model : "openai/gpt-oss-120b";
  console.log("CHAT — using model:", selectedModel);

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: selectedModel,
        messages,
        temperature: 0.7,
        max_tokens: 2048
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );

    const reply = response.data?.choices?.[0]?.message?.content;
    if (!reply) throw new Error("Empty response from Groq");

    console.log("CHAT OK — model:", selectedModel, "— chars:", reply.length);
    return res.json({
      choices: [{ message: { content: reply } }],
      model_used: selectedModel
    });

  } catch (err) {
    const status = err.response?.status;
    const errData = err.response?.data?.error;
    const errMsg = errData?.message || err.message;
    console.log("CHAT ERROR — status:", status, "— msg:", errMsg);

    // Rate limit détecté
    const isRateLimit = status === 429
      || (errMsg && (
        errMsg.toLowerCase().includes("rate limit") ||
        errMsg.toLowerCase().includes("quota") ||
        errMsg.toLowerCase().includes("limit exceeded") ||
        errMsg.toLowerCase().includes("tokens per day") ||
        errMsg.toLowerCase().includes("requests per day")
      ));

    if (isRateLimit && selectedModel === "openai/gpt-oss-120b") {
      console.log("RATE LIMIT HIT — signaling frontend to switch model");
      return res.status(429).json({
        rate_limited: true,
        model_used: selectedModel,
        choices: [{ message: { content: "rate_limit_reached" } }]
      });
    }

    return res.json({
      choices: [{ message: { content: "⚠️ Error: " + errMsg } }]
    });
  }
});

// ── ANALYZE IMAGE ─────────────────────────────────────────────
app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;
  console.log("ANALYZE — question:", question?.slice(0, 50));
  console.log("GROQ_API_KEY =", process.env.GROQ_API_KEY ? "OK" : "MISSING");

  if (!image) {
    return res.json({ choices: [{ message: { content: "No image received" } }] });
  }

  for (const model of VISION_MODELS) {
    try {
      console.log("ANALYZE — trying:", model);
      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model,
          messages: [{
            role: "user",
            content: [
              { type: "image_url", image_url: { url: image } },
              { type: "text", text: question || "Analyze this image in detail. Describe what you see, key elements, colors, context, and anything relevant." }
            ]
          }],
          max_tokens: 2048,
          temperature: 0.7
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
          },
          timeout: 30000
        }
      );
      const reply = response.data?.choices?.[0]?.message?.content;
      if (reply) {
        console.log("ANALYZE OK — model:", model);
        return res.json({ choices: [{ message: { content: reply } }] });
      }
    } catch (err) {
      console.log("ANALYZE — model", model, "failed:", err.response?.data?.error?.message || err.message);
      continue;
    }
  }

  res.json({ choices: [{ message: { content: "⚠️ Image analysis unavailable. Please enable a vision model in your Groq settings." } }] });
});

// ── IMAGE GENERATION ──────────────────────────────────────────
app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  console.log("IMAGE — prompt:", prompt?.slice(0, 60));

  if (!prompt) return res.json({ error: "No prompt received" });

  try {
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&enhance=true&model=flux`;

    const imageBuffer = await new Promise((resolve, reject) => {
      function doGet(url, redirectCount = 0) {
        if (redirectCount > 5) { reject(new Error("Too many redirects")); return; }
        https.get(url, (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            doGet(response.headers.location, redirectCount + 1);
            return;
          }
          console.log("IMAGE — Pollinations status:", response.statusCode);
          const chunks = [];
          response.on("data", chunk => chunks.push(chunk));
          response.on("end", () => resolve(Buffer.concat(chunks)));
          response.on("error", reject);
        }).on("error", reject);
      }
      doGet(imageUrl);
    });

    const base64 = imageBuffer.toString("base64");
    res.json({ image: `data:image/jpeg;base64,${base64}` });

  } catch (err) {
    console.log("IMAGE ERROR:", err.message);
    res.json({ error: "Image generation error: " + err.message });
  }
});

// ── SEARCH ────────────────────────────────────────────────────
app.post("/search", async (req, res) => {
  const { query } = req.body;
  console.log("SEARCH — query:", query);
  console.log("TAVILY_API_KEY =", process.env.TAVILY_API_KEY ? "OK" : "MISSING");

  if (!query) {
    return res.json({ error: "No query provided" });
  }

  if (!process.env.TAVILY_API_KEY) {
    console.log("SEARCH — no Tavily key, returning mock");
    return res.json({
      error: "Search service not configured. Add TAVILY_API_KEY in Render environment variables."
    });
  }

  try {
    const searchRes = await axios.post(
      "https://api.tavily.com/search",
      {
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: true
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 15000
      }
    );

    const data = searchRes.data;
    console.log("SEARCH OK — results:", data.results?.length, "— answer:", data.answer?.slice(0, 80));

    const context = (data.results || []).map((r, i) =>
      `[${i+1}] ${r.title}\n${(r.content || "").slice(0, 500)}\nSource: ${r.url}`
    ).join("\n\n");

    return res.json({
      answer: data.answer || "",
      context,
      sources: (data.results || []).map(r => ({ title: r.title, url: r.url }))
    });

  } catch (err) {
    const errMsg = err.response?.data?.detail || err.response?.data?.message || err.message;
    console.log("SEARCH ERROR:", errMsg);
    return res.json({ error: "Search failed: " + errMsg });
  }
});

// ── SEND CONFIRMATION EMAIL (Gmail SMTP) ──────────────────────
app.post("/send-confirmation", async (req, res) => {
  const { email, name } = req.body;
  console.log("SEND-CONFIRMATION — to:", email);
  console.log("GMAIL_USER =", process.env.GMAIL_USER ? "OK" : "MISSING");
  console.log("GMAIL_PASS =", process.env.GMAIL_PASS ? "OK" : "MISSING");

  if (!email || !name) {
    return res.json({ success: false, error: "Missing email or name" });
  }

  const token = crypto.randomBytes(32).toString("hex");
  pendingTokens.set(token, {
    email,
    name,
    expires: Date.now() + 24 * 60 * 60 * 1000
  });
  const confirmLink = `${FRONTEND_URL}?confirm=${token}`;
  console.log("CONFIRMATION LINK:", confirmLink);

  // Si pas de config Gmail → auto-confirm
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
    console.log("No Gmail config — auto-confirming");
    pendingTokens.delete(token);
    return res.json({ success: true, auto_confirmed: true });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: `"Nova AI 618" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "✅ Confirm your Nova AI 618 account",
      html: `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#050608;font-family:'Segoe UI',sans-serif">
<div style="max-width:520px;margin:40px auto;background:#0b0c12;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#0d0b1a,#070512);padding:40px 32px;text-align:center;border-bottom:1px solid rgba(124,106,255,0.2)">
    <div style="font-size:40px;margin-bottom:12px">🌌</div>
    <h1 style="color:#ebebf2;font-size:22px;margin:0;font-weight:700">Nova AI 618</h1>
    <p style="color:#7c6aff;margin:6px 0 0;font-size:13px">Confirm your account</p>
  </div>
  <div style="padding:32px">
    <p style="color:#ebebf2;font-size:16px;margin:0 0 12px">Hello <strong>${name}</strong> 👋</p>
    <p style="color:#7a7a9a;font-size:14px;line-height:1.7;margin:0 0 28px">
      Thank you for creating a Nova AI 618 account. Click the button below to confirm your email and activate your account.
    </p>
    <div style="text-align:center;margin-bottom:28px">
      <a href="${confirmLink}"
         style="display:inline-block;background:linear-gradient(135deg,#7c6aff,#5b4cd1);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:600">
        ✅ Confirm my account
      </a>
    </div>
    <p style="color:#3e3e55;font-size:12px;text-align:center;margin:0">
      This link expires in 24 hours. If you didn't create this account, ignore this email.
    </p>
  </div>
</div>
</body></html>`
    });

    console.log("EMAIL SENT via Gmail to:", email);
    return res.json({ success: true });

  } catch (err) {
    console.log("GMAIL ERROR:", err.message);
    return res.json({ success: false, error: err.message });
  }
});


// ── VERIFY EMAIL TOKEN ────────────────────────────────────────
app.get("/verify-email", (req, res) => {
  const { token } = req.query;
  console.log("VERIFY-EMAIL — token:", token?.slice(0, 20) + "...");

  if (!token) return res.json({ success: false, error: "No token provided" });

  const data = pendingTokens.get(token);
  if (!data) return res.json({ success: false, error: "Invalid or expired token" });

  if (Date.now() > data.expires) {
    pendingTokens.delete(token);
    return res.json({ success: false, error: "Token expired" });
  }

  pendingTokens.delete(token);
  console.log("EMAIL VERIFIED —", data.email);
  return res.json({ success: true, email: data.email, name: data.name });
});

app.listen(PORT, () => {
  console.log(`Nova AI Server running on port ${PORT}`);
  console.log("Environment check:");
  console.log("  GROQ_API_KEY:", process.env.GROQ_API_KEY ? "✅" : "❌ MISSING");
  console.log("  TAVILY_API_KEY:", process.env.TAVILY_API_KEY ? "✅" : "❌ MISSING");
  console.log("  RESEND_API_KEY:", process.env.RESEND_API_KEY ? "✅" : "❌ MISSING");
});
