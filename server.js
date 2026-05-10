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

const pendingTokens = new Map();

const VISION_MODELS = [
  "llama-3.2-90b-vision-preview",
  "llama-3.2-11b-vision-preview",
  "llava-v1.5-7b-4096-preview"
];

// Modèles Code — essayés dans l'ordre si le premier échoue
const CODE_MODELS = [
  "laguna/laguna-m.1-instruct",
  "deepseek/deepseek-coder",
  "qwen/qwen-2.5-coder-32b-instruct"
];

// ═══════════════════════════════════════════════════════════
//  NODEMAILER
// ═══════════════════════════════════════════════════════════
function createTransporter() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  /debug-env — diagnostic des variables d'environnement
//  Ouvre dans ton navigateur pour vérifier que Render a bien
//  chargé toutes les clés après redéploiement.
// ═══════════════════════════════════════════════════════════
app.get("/debug-env", (req, res) => {
  const or = process.env.OPENROUTER_API_KEY;
  res.json({
    GROQ_API_KEY:        process.env.GROQ_API_KEY       ? `OK (${process.env.GROQ_API_KEY.slice(0,8)}...)`   : "ABSENT",
    OPENROUTER_API_KEY:  or ? `OK (${or.slice(0,8)}...) len=${or.length}` : "ABSENT",
    TAVILY_API_KEY:      process.env.TAVILY_API_KEY     ? `OK (${process.env.TAVILY_API_KEY.slice(0,8)}...)` : "ABSENT",
    GMAIL_USER:          process.env.GMAIL_USER         ? `OK (${process.env.GMAIL_USER})`                   : "ABSENT",
    GMAIL_APP_PASSWORD:  process.env.GMAIL_APP_PASSWORD ? `OK len=${process.env.GMAIL_APP_PASSWORD.length}`  : "ABSENT",
    NODE_ENV:            process.env.NODE_ENV || "non défini",
    server_time:         new Date().toISOString()
  });
});

// ═══════════════════════════════════════════════════════════
//  ROOT
// ═══════════════════════════════════════════════════════════
app.get("/", (req, res) => {
  res.send("Nova AI 618 Server Online — /chat /code /search /image /analyze /send-confirmation /verify-email /debug-env");
});

// ═══════════════════════════════════════════════════════════
//  /chat — Groq (GPT-OSS 120B / Llama 70B / Llama 8B)
// ═══════════════════════════════════════════════════════════
app.post("/chat", async (req, res) => {
  const { messages, model } = req.body;
  if (!messages) return res.status(400).json({ error: "Messages required" });

  const validModels = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
  const selectedModel = validModels.includes(model) ? model : "openai/gpt-oss-120b";

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      { model: selectedModel, messages, temperature: 0.7, max_tokens: 2048 },
      { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, timeout: 30000 }
    );
    res.json(response.data);
  } catch (err) {
    console.error("Groq /chat error:", err.response?.data || err.message);
    if (err.response?.status === 429) return res.status(429).json({ rate_limited: true });
    res.status(500).json({ error: "AI error" });
  }
});

// ═══════════════════════════════════════════════════════════
//  /code — OpenRouter avec fallbacks
//
//  CAUSE DU BUG "not configured" :
//  → Render ne recharge PAS les env vars sans redéploiement.
//  → Si tu ajoutes OPENROUTER_API_KEY dans le dashboard APRÈS
//    le dernier deploy, le serveur ne la voit pas.
//  → Solution : après avoir ajouté la variable dans Render,
//    clique sur "Manual Deploy > Deploy latest commit".
//
//  Ce code lit la clé à chaque requête (pas au boot) pour
//  éviter tout problème de cache, et .trim() supprime les
//  espaces/retours à la ligne accidentels.
// ═══════════════════════════════════════════════════════════
app.post("/code", async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: "Messages required" });

  // Lecture à la demande + nettoyage
  const rawKey = process.env.OPENROUTER_API_KEY;
  const apiKey = rawKey ? rawKey.trim() : "";

  console.log(`[/code] OPENROUTER_API_KEY: ${apiKey ? "PRESENT (" + apiKey.slice(0,8) + "... len=" + apiKey.length + ")" : "ABSENT"}`);

  if (!apiKey) {
    return res.status(500).json({
      error: "OPENROUTER_API_KEY not configured on server",
      fix: "1) Ajoute OPENROUTER_API_KEY dans Render > Environment. 2) Clique 'Manual Deploy'. 3) Vérifie /debug-env."
    });
  }

  let lastError = null;

  for (const modelId of CODE_MODELS) {
    try {
      console.log(`[/code] Trying model: ${modelId}`);

      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: modelId,
          messages,
          temperature: 0.2,
          max_tokens: 4096
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

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty response from model");

      console.log(`[/code] SUCCESS with ${modelId}`);
      const data = response.data;
      data._modelUsed = modelId;
      return res.json(data);

    } catch (err) {
      const status = err.response?.status;
      const errMsg = err.response?.data?.error?.message || err.message;
      console.warn(`[/code] ${modelId} failed (HTTP ${status || "?"}): ${errMsg}`);
      lastError = { status, message: errMsg, model: modelId };

      // Clé invalide → inutile d'essayer les autres
      if (status === 401) {
        return res.status(401).json({
          error: "OpenRouter API key invalid (401)",
          detail: "Vérifie que la clé est correcte dans Render et redéploie.",
          raw: errMsg
        });
      }
      // Autres erreurs → on tente le modèle suivant
    }
  }

  console.error("[/code] All models failed:", lastError);
  res.status(500).json({
    error: "Code Mode unavailable — all models failed",
    lastError,
    tip: "Vérifie /debug-env et redéploie sur Render."
  });
});

// ═══════════════════════════════════════════════════════════
//  /search — Tavily
// ═══════════════════════════════════════════════════════════
app.post("/search", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "Query required" });

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
      context: data.results?.map((r, i) =>
        `[${i + 1}] ${r.title}\n${(r.content || "").slice(0, 450)}\nSource: ${r.url}`
      ).join("\n\n") || "",
      sources: data.results?.map(r => ({ title: r.title, url: r.url })) || []
    });
  } catch (err) {
    console.error("Tavily /search error:", err.message);
    res.status(500).json({ error: "Search failed" });
  }
});

// ═══════════════════════════════════════════════════════════
//  /image — Pollinations.ai
// ═══════════════════════════════════════════════════════════
app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt required" });

  try {
    const encodedPrompt = encodeURIComponent(prompt);
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&enhance=true&model=flux`;

    const buf = await new Promise((resolve, reject) => {
      https.get(url, (response) => {
        const chunks = [];
        response.on("data", c => chunks.push(c));
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", reject);
      }).on("error", reject);
    });

    res.json({ image: `data:image/jpeg;base64,${buf.toString("base64")}` });
  } catch (err) {
    console.error("Pollinations /image error:", err.message);
    res.status(500).json({ error: "Image generation failed" });
  }
});

// ═══════════════════════════════════════════════════════════
//  /analyze — Groq Vision
// ═══════════════════════════════════════════════════════════
app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;
  if (!image) return res.status(400).json({ error: "Image required" });

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
        { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, timeout: 30000 }
      );
      const reply = response.data?.choices?.[0]?.message?.content;
      if (reply) return res.json({ choices: [{ message: { content: reply } }] });
    } catch (err) {
      console.log(`Vision ${model} failed:`, err.response?.data?.error?.message || err.message);
    }
  }
  res.status(500).json({ error: "Image analysis unavailable" });
});

// ═══════════════════════════════════════════════════════════
//  /send-confirmation — token + email Nodemailer
// ═══════════════════════════════════════════════════════════
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
  console.log(`Token created for ${email}`);

  const transporter = createTransporter();
  if (!transporter) {
    console.warn("Email non envoyé (Gmail non configuré)");
    return res.json({ success: true, confirmLink, emailSent: false });
  }

  const mailOptions = {
    from: `"Nova AI 618" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: "Confirm your Nova AI 618 account",
    html: `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body{font-family:'Segoe UI',Arial,sans-serif;background:#050608;color:#ebebf2;margin:0;padding:0}
.wrap{max-width:520px;margin:40px auto;background:#0b0c12;border:1px solid rgba(255,255,255,0.08);border-radius:18px;overflow:hidden}
.head{background:linear-gradient(135deg,#0d0a1e,#070512);padding:36px 32px;text-align:center;border-bottom:1px solid rgba(124,106,255,0.2)}
.logo{font-size:26px;font-weight:800;color:#ebebf2;letter-spacing:-0.5px}
.logo em{color:#7c6aff;font-style:normal}
.sub{color:#7a7a9a;font-size:13px;margin-top:6px}
.body{padding:32px}
.greet{font-size:17px;font-weight:600;margin-bottom:12px;color:#ebebf2}
.txt{color:#7a7a9a;font-size:14px;line-height:1.7;margin-bottom:28px}
.btn-wrap{text-align:center;margin:24px 0}
.btn{display:inline-block;background:#7c6aff;color:#ffffff !important;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:700;font-size:15px}
.expire{background:rgba(255,140,0,0.08);border:1px solid rgba(255,140,0,0.2);border-radius:8px;padding:10px 14px;font-size:12px;color:rgba(255,140,0,0.9);margin-top:20px}
.linkbox{margin-top:16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px 14px;font-size:11px;color:#3e3e55;word-break:break-all}
.linkbox a{color:#7c6aff}
.foot{padding:18px 32px;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:#3e3e55;text-align:center}
</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <div class="logo">NOVA <em>AI 618</em></div>
    <div class="sub">Created by Sixte · Intelligence redefined</div>
  </div>
  <div class="body">
    <div class="greet">Hello ${name} 👋</div>
    <div class="txt">
      Welcome to <strong style="color:#ebebf2">Nova AI 618</strong>!<br>
      Click below to confirm your account and unlock <strong style="color:#7c6aff">Code Mode</strong> with Laguna M.1.
    </div>
    <div class="btn-wrap">
      <a href="${confirmLink}" class="btn">Confirm my account</a>
    </div>
    <div class="expire">This link expires in <strong>24 hours</strong>.</div>
    <div class="linkbox">
      If the button doesn't work:<br>
      <a href="${confirmLink}">${confirmLink}</a>
    </div>
  </div>
  <div class="foot">
    Nova AI 618 · Created by Sixte Leinekugel<br>
    If you didn't create an account, ignore this email.
  </div>
</div>
</body>
</html>`,
    text: `Hello ${name},\n\nConfirm your Nova AI 618 account:\n${confirmLink}\n\nExpires in 24h.\n— Nova AI 618`
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${email}`);
    res.json({ success: true, confirmLink, emailSent: true });
  } catch (err) {
    console.error("Nodemailer error:", err.message);
    res.json({ success: true, confirmLink, emailSent: false, emailError: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  /verify-email — valide le token
// ═══════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════
//  DÉMARRAGE
// ═══════════════════════════════════════════════════════════
app.listen(PORT, () => {
  const or = process.env.OPENROUTER_API_KEY;
  console.log(`\n🚀 Nova AI 618 Server — port ${PORT}`);
  console.log(`   GROQ_API_KEY       : ${process.env.GROQ_API_KEY       ? "OK " + process.env.GROQ_API_KEY.slice(0,8) + "..."       : "ABSENT"}`);
  console.log(`   OPENROUTER_API_KEY : ${or ? "OK " + or.slice(0,8) + "... len=" + or.length : "ABSENT ← redéploie après ajout !"}`);
  console.log(`   TAVILY_API_KEY     : ${process.env.TAVILY_API_KEY     ? "OK " + process.env.TAVILY_API_KEY.slice(0,8) + "..."     : "ABSENT"}`);
  console.log(`   GMAIL_USER         : ${process.env.GMAIL_USER         ? "OK " + process.env.GMAIL_USER                           : "ABSENT"}`);
  console.log(`   GMAIL_APP_PASSWORD : ${process.env.GMAIL_APP_PASSWORD ? "OK len=" + process.env.GMAIL_APP_PASSWORD.length        : "ABSENT"}`);
  console.log(`\n   Debug: https://jarvis-backend-utkp.onrender.com/debug-env\n`);
});
