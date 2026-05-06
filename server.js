import express from "express";
import cors from "cors";
import axios from "axios";
import https from "https";
import crypto from "crypto";
import { Resend } from "resend";

const app = express();

// ====================== CONFIG ======================
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 10000;
const resend = new Resend(process.env.RESEND_API_KEY);
const FRONTEND_URL = "https://sixteleinekugel-commits.github.io/novaAI-chat";

const pendingTokens = new Map();

// ====================== ROUTES ======================
app.get("/", (req, res) => {
  res.send("🚀 Nova AI 618 Server is Online");
});

// ── Chat Principal ─────────────────────────────────────
app.post("/chat", async (req, res) => {
  const { messages, model } = req.body;

  if (!messages) return res.status(400).json({ error: "Messages required" });

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
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }
      }
    );

    res.json(response.data);
  } catch (err) {
    console.error("Groq Error:", err.response?.data || err.message);
    if (err.response?.status === 429) {
      return res.status(429).json({ rate_limited: true });
    }
    res.status(500).json({ error: "AI response failed" });
  }
});

// ── Search Web (Tavily) ───────────────────────────────────
app.post("/search", async (req, res) => {
  const { query } = req.body;

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Query is required" });
  }

  if (!process.env.TAVILY_API_KEY) {
    return res.status(500).json({ error: "Search service not configured" });
  }

  try {
    const response = await axios.post("https://api.tavily.com/search", {
      api_key: process.env.TAVILY_API_KEY,
      query: query.trim(),
      search_depth: "basic",
      max_results: 6,
      include_answer: true
    }, { timeout: 15000 });

    const data = response.data;

    res.json({
      answer: data.answer || "",
      context: data.results?.map((r, i) =>
        `[${i+1}] ${r.title}\n${r.content ? r.content.slice(0, 450) : ''}\nSource: ${r.url}`
      ).join("\n\n") || "No results found.",
      sources: data.results?.map(r => ({ title: r.title, url: r.url })) || []
    });

  } catch (err) {
    console.error("Tavily Error:", err.message);
    res.status(500).json({ error: "Search failed. Please try again." });
  }
});

// ── Image Generation ─────────────────────────────────────
app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt required" });

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

    res.json({ image: `data:image/jpeg;base64,${imageBuffer.toString("base64")}` });
  } catch (err) {
    res.status(500).json({ error: "Image generation failed" });
  }
});

// ── Analyze Image ───────────────────────────────────────
app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;
  if (!image) return res.status(400).json({ error: "Image required" });

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.2-90b-vision-preview",
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
      { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } }
    );

    res.json({ choices: [{ message: { content: response.data.choices[0].message.content } }] });
  } catch (err) {
    res.status(500).json({ error: "Image analysis failed" });
  }
});

// ── Email Confirmation ───────────────────────────────────
app.post("/send-confirmation", async (req, res) => {
  const { email, name } = req.body;
  if (!email || !name) return res.status(400).json({ success: false, error: "Missing email or name" });

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
      html: `<h2>Hello ${name},</h2><p>Click the link to confirm your account:</p><a href="${confirmLink}">Confirm Account</a>`
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to send email" });
  }
});

app.get("/verify-email", (req, res) => {
  const { token } = req.query;
  const data = pendingTokens.get(token);
  if (!data || Date.now() > data.expires) {
    return res.status(400).json({ success: false, error: "Invalid or expired token" });
  }
  pendingTokens.delete(token);
  res.json({ success: true, email: data.email, name: data.name });
});

// ====================== START ======================
app.listen(PORT, () => {
  console.log(`🚀 Nova AI 618 Server running on port ${PORT}`);
});
