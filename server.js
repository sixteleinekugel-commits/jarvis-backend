import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import axios from "axios";
import https from "https";
import crypto from "crypto";
import { Resend } from "resend";

const app = express();

// ====================== MIDDLEWARES ======================
app.use(helmet());

app.use(cors({
  origin: [
    "https://sixteleinekugel-commits.github.io",
    "http://localhost:5500",
    "http://127.0.0.1:5500"
  ],
  methods: ["GET", "POST"],
  credentials: true
}));

app.use(express.json({ limit: "20mb" }));

// Rate limiting global
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 150, // limite par IP
  message: { error: "Too many requests, please try again later." }
});
app.use(limiter);

// ====================== CONFIG ======================
const PORT = process.env.PORT || 10000;
const resend = new Resend(process.env.RESEND_API_KEY);
const FRONTEND_URL = "https://sixteleinekugel-commits.github.io/novaAI-chat";

const pendingTokens = new Map();

const VISION_MODELS = [
  "llama-3.2-90b-vision-preview",
  "llama-3.2-11b-vision-preview",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "llava-v1.5-7b-4096-preview"
];

// ====================== ROUTES ======================
app.get("/", (req, res) => {
  res.send("Nova AI 618 Server Running 🚀");
});

// ── Chat ─────────────────────────────────────────────────────
app.post("/chat", async (req, res) => {
  const { messages, model } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Messages array is required" });
  }

  const validModels = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
  const selectedModel = validModels.includes(model) ? model : "openai/gpt-oss-120b";

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

    const reply = response.data?.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response.";
    
    return res.json({ 
      choices: [{ message: { content: reply } }], 
      model_used: selectedModel 
    });

  } catch (err) {
    console.error("Groq Error:", err.response?.data || err.message);
    
    const status = err.response?.status;
    const errMsg = err.response?.data?.error?.message || err.message;

    if (status === 429 || errMsg.toLowerCase().includes("rate limit") || errMsg.toLowerCase().includes("quota")) {
      if (selectedModel === "openai/gpt-oss-120b") {
        return res.status(429).json({ rate_limited: true });
      }
    }

    return res.status(500).json({ 
      error: "Internal server error",
      message: "Failed to get response from AI model" 
    });
  }
});

// ── Analyze Image ─────────────────────────────────────────────
app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;
  if (!image) return res.status(400).json({ error: "No image provided" });

  for (const model of VISION_MODELS) {
    try {
      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model,
          messages: [{
            role: "user",
            content: [
              { type: "image_url", image_url: { url: image } },
              { type: "text", text: question || "Analyze this image in detail." }
            ]
          }],
          max_tokens: 1024,
          temperature: 0.7
        },
        {
          headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
          timeout: 25000
        }
      );

      const reply = response.data?.choices?.[0]?.message?.content;
      if (reply) return res.json({ choices: [{ message: { content: reply } }] });

    } catch (err) {
      console.log(`Vision model ${model} failed:`, err.response?.data?.error?.message || err.message);
      continue;
    }
  }

  res.status(500).json({ error: "All vision models failed" });
});

// ── Image Generation ──────────────────────────────────────────
app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  try {
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&enhance=true&model=flux`;

    const imageBuffer = await new Promise((resolve, reject) => {
      https.get(imageUrl, (response) => {
        const chunks = [];
        response.on("data", chunk => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks)));
      }).on("error", reject);
    });

    res.json({ 
      image: `data:image/jpeg;base64,${imageBuffer.toString("base64")}` 
    });
  } catch (err) {
    console.error("Image generation error:", err.message);
    res.status(500).json({ error: "Failed to generate image" });
  }
});

// ── Search (Tavily) ───────────────────────────────────────────
app.post("/search", async (req, res) => {
  const { query } = req.body;

  console.log("🔍 SEARCH QUERY =", query);

  if (!query || typeof query !== "string" || query.trim() === "") {
    return res.status(400).json({ error: "Query is required" });
  }

  if (!process.env.TAVILY_API_KEY) {
    console.error("❌ TAVILY_API_KEY MANQUANTE");
    return res.status(500).json({ error: "Search service not configured on server" });
  }

  try {
    const response = await axios.post(
      "https://api.tavily.com/search",
      {
        api_key: process.env.TAVILY_API_KEY,
        query: query.trim(),
        search_depth: "basic",
        max_results: 5,
        include_answer: true
      },
      {
        timeout: 12000
      }
    );

    const data = response.data;

    console.log("✅ TAVILY RESPONSE OK");

    res.json({
      answer: data.answer || "",
      context: data.results
        ? data.results.map((r, i) =>
            `[${i + 1}] ${r.title}\n${r.content?.slice(0, 400) || ""}\nSource: ${r.url}`
          ).join("\n\n")
        : "No results found.",
      sources: data.results
        ? data.results.map(r => ({
            title: r.title,
            url: r.url
          }))
        : []
    });

  } catch (error) {
    console.error("❌ TAVILY ERROR FULL:", error.response?.data || error.message);

    res.status(500).json({
      error: "Search failed",
      detail: error.response?.data || error.message
    });
  }
});
// ── Email Confirmation ────────────────────────────────────────
app.post("/send-confirmation", async (req, res) => {
  const { email, name } = req.body;
  if (!email || !name) return res.status(400).json({ success: false, error: "Email and name required" });

  if (!process.env.RESEND_API_KEY) {
    return res.json({ success: true, auto_confirmed: true });
  }

  const token = crypto.randomBytes(32).toString("hex");
  pendingTokens.set(token, { email, name, expires: Date.now() + 24 * 60 * 60 * 1000 });

  const confirmLink = `${FRONTEND_URL}?confirm=${token}`;

  try {
    await resend.emails.send({
      from: "Nova AI 618 <onboarding@resend.dev>",
      to: email,
      subject: "✅ Confirm your Nova AI 618 account",
      html: `...` // (ton HTML email reste le même)
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Resend Error:", err);
    res.status(500).json({ success: false, error: "Failed to send email" });
  }
});

// ── Verify Email ─────────────────────────────────────────────
app.get("/verify-email", (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ success: false, error: "No token" });

  const data = pendingTokens.get(token);
  if (!data) return res.status(400).json({ success: false, error: "Invalid or expired token" });
  if (Date.now() > data.expires) {
    pendingTokens.delete(token);
    return res.status(400).json({ success: false, error: "Token expired" });
  }

  pendingTokens.delete(token);
  res.json({ success: true, email: data.email, name: data.name });
});

// ====================== START SERVER ======================
app.listen(PORT, () => {
  console.log(`🚀 Nova AI 618 Server running on port ${PORT}`);
});
