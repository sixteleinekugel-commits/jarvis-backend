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

// ── MODEL SWITCH ───────────────────────────────────────────
app.post("/chat", async (req, res) => {
  const { messages, model } = req.body;
  if (!messages) return res.json({ choices: [{ message: { content: "No message received" } }] });

  const validModels = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
  const selectedModel = validModels.includes(model) ? model : "openai/gpt-oss-120b";

  console.log("Using model:", selectedModel);

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
        }
      }
    );

    const reply = response.data?.choices?.[0]?.message?.content || "AI Error";
    console.log("Groq OK —", selectedModel);
    return res.json({
      choices: [{ message: { content: reply } }],
      model_used: selectedModel
    });

  } catch (err) {
    const status = err.response?.status;
    const errMsg = err.response?.data?.error?.message || err.message;
    console.log("GROQ ERROR:", status, errMsg);

    const isRateLimit = status === 429
      || errMsg.toLowerCase().includes("rate limit")
      || errMsg.toLowerCase().includes("quota")
      || errMsg.toLowerCase().includes("limit exceeded")
      || errMsg.toLowerCase().includes("tokens per day");

    if (isRateLimit && selectedModel === "openai/gpt-oss-120b") {
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

// ── ANALYZE IMAGE ───────────────────────────────────────────
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
          max_tokens: 2048,
          temperature: 0.7
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
          }
        }
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

// ── IMAGE GENERATION (Pollinations) ────────────────────────
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
          if (response.statusCode === 301 || response.statusCode === 302) {
            doGet(response.headers.location, redirectCount + 1);
            return;
          }
          console.log("Pollinations STATUS:", response.statusCode);
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

// ✅ SEARCH (Tavily - version "comme avant" avec api_key dans le body)
app.post("/search", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.json({ error: "No query provided" });

  try {
    const response = await axios.post(
      "https://api.tavily.com/search",
      {
        api_key: process.env.TAVILY_API_KEY,  // ✅ Clé dans le body (format ancien)
        query: query,
        search_depth: "basic",
        max_results: 5,
        include_answer: true,
        include_raw_content: false
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 10000
      }
    );

    const data = response.data;

    if (!data || !data.results) {
      return res.json({ error: "Invalid response from Tavily API" });
    }

    const context = data.results
      .map((r, i) => `[${i + 1}] ${r.title || "No title"}\n${r.content || "No content"}\nSource: ${r.url || "No URL"}`)
      .join("\n\n");

    res.json({
      answer: data.answer || "",
      context: context,
      sources: data.results.map(r => ({
        title: r.title || "No title",
        url: r.url || "No URL"
      }))
    });

  } catch (err) {
    console.log("Tavily error:", err.response?.data || err.message);
    res.json({
      error: "Search error: " + (err.response?.data?.message || err.message)
    });
  }
});

// ── EMAIL CONFIRMATION ─────────────────────────────────────
app.post("/send-confirmation", async (req, res) => {
  const { email, name } = req.body;
  if (!email || !name) return res.json({ success: false, error: "Missing email or name" });

  const token = crypto.randomBytes(32).toString("hex");
  pendingTokens.set(token, { email, name, expires: Date.now() + 24 * 60 * 60 * 1000 });
  const confirmLink = `${FRONTEND_URL}?confirm=${token}`;

  try {
    await resend.emails.send({
      from: "Nova AI 618 <noreply@yourdomain.com>",
      to: email,
      subject: "✅ Confirm your Nova AI 618 account",
      html: `
        <!DOCTYPE html>
        <html>
        <body style="margin:0;padding:0;background:#050608;font-family:'Segoe UI',sans-serif">
          <div style="max-width:520px;margin:40px auto;background:#0b0c12;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden">
            <div style="background:linear-gradient(135deg,#0d0b1a,#070512);padding:40px 32px;text-align:center;border-bottom:1px solid rgba(124,106,255,0.2)">
              <div style="width:60px;height:60px;margin:0 auto 16px;border-radius:50%;display:flex;align-items:center;justify-content:center">
                <svg width="60" height="60" viewBox="0 0 100 100"><use href="#bh-icon"/></svg>
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

// ── VERIFY EMAIL ───────────────────────────────────────────
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

// ── VIDEO GENERATION (Pollinations) ────────────────────────
app.post("/video", async (req, res) => {
  const { prompt, imageUrl } = req.body;
  console.log("VIDEO PROMPT =", prompt);
  console.log("IMAGE URL =", imageUrl || "None");

  if (!prompt) {
    return res.json({ error: "No prompt received" });
  }

  try {
    let videoUrl;
    if (imageUrl) {
      videoUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true&model=flux&video=true&image_url=${encodeURIComponent(imageUrl)}`;
    } else {
      videoUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true&model=flux&video=true`;
    }

    console.log("Pollinations Video URL:", videoUrl);

    const videoBuffer = await new Promise((resolve, reject) => {
      function doGet(url, redirectCount = 0) {
        if (redirectCount > 5) { reject(new Error("Too many redirects")); return; }
        https.get(url, (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            doGet(response.headers.location, redirectCount + 1);
            return;
          }
          console.log("Pollinations Video STATUS:", response.statusCode);
          const chunks = [];
          response.on("data", chunk => chunks.push(chunk));
          response.on("end", () => resolve(Buffer.concat(chunks)));
          response.on("error", reject);
        }).on("error", reject);
      }
      doGet(videoUrl);
    });

    const base64 = videoBuffer.toString("base64");
    res.json({
      video: `data:video/mp4;base64,${base64}`,
      url: videoUrl
    });

  } catch (err) {
    console.log("VIDEO ERROR:", err.message);
    res.json({ error: "Video generation error: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Nova AI Server running on port ${PORT}`);
});
