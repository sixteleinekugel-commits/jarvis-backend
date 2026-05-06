import express from "express";
import cors from "cors";
import axios from "axios";
import https from "https";
import crypto from "crypto";
import { Resend } from "resend";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 10000;
const resend = new Resend(process.env.RESEND_API_KEY);
const FRONTEND_URL = "https://sixteleinekugel-commits.github.io/novaAI-chat";

// Stock temporaire des tokens (en prod utilise une DB)
const pendingTokens = new Map();

const VISION_MODELS = [
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "llava-v1.5-7b-4096-preview",
  "llama-3.2-11b-vision-preview",
  "llama-3.2-90b-vision-preview"
];

app.get("/", (req, res) => {
  res.send("Nova AI Server OK 🚀");
});

// ── Fallback HuggingFace ────────────────────────────────────
async function hfFallback(messages) {
  console.log("Switching to HuggingFace fallback...");
  const prompt = messages.map(m => {
    if (m.role === "system") return `<|system|>\n${m.content}`;
    if (m.role === "user") return `<|user|>\n${m.content}`;
    if (m.role === "assistant") return `<|assistant|>\n${m.content}`;
    return m.content;
  }).join("\n") + "\n<|assistant|>\n";

  const response = await axios.post(
    "https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3-8B-Instruct",
    {
      inputs: prompt,
      parameters: { max_new_tokens: 1024, temperature: 0.7, return_full_text: false }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
        "Content-Type": "application/json"
      },
      timeout: 60000
    }
  );

  const data = response.data;
  const text = Array.isArray(data) ? data[0]?.generated_text : data?.generated_text;
  if (!text) throw new Error("No text from HuggingFace");
  const cleaned = text.includes("<|assistant|>")
    ? text.split("<|assistant|>").pop().trim()
    : text.trim();
  return cleaned;
}

// ── Chat (Groq + fallback HF) ───────────────────────────────
app.post("/chat", async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.json({ choices: [{ message: { content: "No message received" } }] });

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      { model: "llama-3.3-70b-versatile", messages, temperature: 0.7, max_tokens: 2048 },
      { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" } }
    );

    const data = response.data;
    if (data.error) throw new Error(data.error.message);
    const reply = data?.choices?.[0]?.message?.content || "AI Error";
    console.log("Groq OK");
    return res.json({ choices: [{ message: { content: reply } }] });

  } catch (groqErr) {
    const status = groqErr.response?.status;
    const errMsg = groqErr.response?.data?.error?.message || groqErr.message;
    console.log("GROQ ERROR:", status, errMsg);

    const shouldFallback = status === 429 || status === 413 || status === 503
      || errMsg.toLowerCase().includes("rate limit")
      || errMsg.toLowerCase().includes("quota")
      || errMsg.toLowerCase().includes("limit");

    if (!shouldFallback) {
      return res.json({ choices: [{ message: { content: "⚠️ Error: " + errMsg } }] });
    }

    try {
      const reply = await hfFallback(messages);
      console.log("HF fallback OK");
      return res.json({ choices: [{ message: { content: reply } }], fallback: true });
    } catch (hfErr) {
      console.log("HF ERROR:", hfErr.message);
      return res.json({ choices: [{ message: { content: "⚠️ Service temporarily unavailable. Please try again later." } }] });
    }
  }
});

// ── Analyse image (vision avec fallback modèles) ────────────
app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;
  if (!image) return res.json({ choices: [{ message: { content: "No image received" } }] });

  for (const model of VISION_MODELS) {
    try {
      console.log(`Trying vision model: ${model}`);
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
          max_tokens: 2048, temperature: 0.7
        },
        { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" } }
      );
      const reply = response.data?.choices?.[0]?.message?.content;
      if (reply) {
        console.log(`Vision OK with ${model}`);
        return res.json({ choices: [{ message: { content: reply } }] });
      }
    } catch (err) {
      console.log(`Model ${model} failed:`, err.response?.data?.error?.message || err.message);
      continue;
    }
  }
  res.json({ choices: [{ message: { content: "⚠️ Image analysis unavailable. Please enable a vision model in your Groq project settings." } }] });
});

// ── Image (Pollinations) ────────────────────────────────────
app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.json({ error: "No prompt received" });
  try {
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&enhance=true&model=flux`;
    const imageBuffer = await new Promise((resolve, reject) => {
      function doGet(url, redirectCount = 0) {
        if (redirectCount > 5) { reject(new Error("Too many redirects")); return; }
        https.get(url, (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) { doGet(response.headers.location, redirectCount + 1); return; }
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
    res.json({ error: "Image generation error: " + err.message });
  }
});

// ── Search (Tavily) ─────────────────────────────────────────
app.post("/search", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.json({ error: "No query" });
  try {
    const searchRes = await axios.post(
      "https://api.tavily.com/search",
      { api_key: process.env.TAVILY_API_KEY, query, search_depth: "basic", max_results: 5, include_answer: true },
      { headers: { "Content-Type": "application/json" } }
    );
    const data = searchRes.data;
    const context = data.results.map((r, i) => `[${i+1}] ${r.title}\n${r.content}\nSource: ${r.url}`).join("\n\n");
    res.json({ answer: data.answer || "", context, sources: data.results.map(r => ({ title: r.title, url: r.url })) });
  } catch (err) {
    res.json({ error: "Search error: " + err.message });
  }
});

// ── Email confirmation ──────────────────────────────────────
app.post("/send-confirmation", async (req, res) => {
  const { email, name } = req.body;
  if (!email || !name) return res.json({ success: false, error: "Missing email or name" });

  const token = crypto.randomBytes(32).toString("hex");
  // Stocke le token avec expiration 24h
  pendingTokens.set(token, { email, name, expires: Date.now() + 24 * 60 * 60 * 1000 });

  const confirmLink = `${FRONTEND_URL}?confirm=${token}`;

  try {
    await resend.emails.send({
      from: "Nova AI 618 <noreply@yourdomain.com>", // ← mets ton domaine vérifié sur Resend
      to: email,
      subject: "✅ Confirm your Nova AI 618 account",
      html: `
        <!DOCTYPE html>
        <html>
        <body style="margin:0;padding:0;background:#050608;font-family:'Segoe UI',sans-serif">
          <div style="max-width:520px;margin:40px auto;background:#0b0c12;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden">
            <div style="background:linear-gradient(135deg,#0d0b1a,#070512);padding:40px 32px;text-align:center;border-bottom:1px solid rgba(124,106,255,0.2)">
              <div style="width:60px;height:60px;margin:0 auto 16px;background:#000;border-radius:50%;display:flex;align-items:center;justify-content:center">
                <div style="font-size:28px">🌌</div>
              </div>
              <h1 style="color:#ebebf2;font-size:22px;margin:0;font-weight:700">Nova AI 618</h1>
              <p style="color:#7c6aff;margin:6px 0 0;font-size:13px">Confirm your account</p>
            </div>
            <div style="padding:32px">
              <p style="color:#ebebf2;font-size:16px;margin:0 0 12px">Hello <strong>${name}</strong> 👋</p>
              <p style="color:#7a7a9a;font-size:14px;line-height:1.7;margin:0 0 28px">
                Thank you for creating a Nova AI 618 account. Click the button below to confirm your email address and activate your account.
              </p>
              <div style="text-align:center;margin-bottom:28px">
                <a href="${confirmLink}" style="display:inline-block;background:linear-gradient(135deg,#7c6aff,#5b4cd1);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:600;letter-spacing:0.02em">
                  ✅ Confirm my account
                </a>
              </div>
              <p style="color:#3e3e55;font-size:12px;text-align:center;margin:0">
                This link expires in 24 hours. If you didn't create an account, ignore this email.
              </p>
            </div>
          </div>
        </body>
        </html>
      `
    });
    console.log("Confirmation email sent to:", email);
    res.json({ success: true });
  } catch (err) {
    console.log("EMAIL ERROR:", err.message);
    res.json({ success: false, error: err.message });
  }
});

// ── Verify token ────────────────────────────────────────────
app.get("/verify-email", (req, res) => {
  const { token } = req.query;
  if (!token) return res.json({ success: false, error: "No token" });

  const data = pendingTokens.get(token);
  if (!data) return res.json({ success: false, error: "Invalid or expired token" });
  if (Date.now() > data.expires) {
    pendingTokens.delete(token);
    return res.json({ success: false, error: "Token expired" });
  }

  pendingTokens.delete(token);
  console.log("Email verified:", data.email);
  res.json({ success: true, email: data.email, name: data.name });
});

app.listen(PORT, () => {
  console.log(`Nova AI Server running on port ${PORT}`);
});
