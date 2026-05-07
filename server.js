// ─────────────────────────────────────────────────────────────
// NOVA AI 618 SERVER
// ─────────────────────────────────────────────────────────────

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

const FRONTEND_URL =
  "https://sixteleinekugel-commits.github.io/novaAI-chat";

// ─────────────────────────────────────────────────────────────
// TOKENS
// ─────────────────────────────────────────────────────────────

const pendingTokens = new Map();

// ─────────────────────────────────────────────────────────────
// VISION MODELS
// ─────────────────────────────────────────────────────────────

const VISION_MODELS = [
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "llava-v1.5-7b-4096-preview",
  "llama-3.2-11b-vision-preview",
  "llama-3.2-90b-vision-preview"
];

// ─────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({
    status: "Nova AI 618 Server Running 🚀",
    routes: [
      "/chat",
      "/image",
      "/analyze",
      "/search",
      "/send-confirmation",
      "/verify-email"
    ]
  });
});

// ─────────────────────────────────────────────────────────────
// CHAT
// ─────────────────────────────────────────────────────────────

app.post("/chat", async (req, res) => {
  const { messages, model } = req.body;

  if (!messages || !messages.length) {
    return res.json({
      choices: [
        {
          message: {
            content: "No message received"
          }
        }
      ]
    });
  }

  const VALID_MODELS = [
    "openai/gpt-oss-120b",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant"
  ];

  const selectedModel = VALID_MODELS.includes(model)
    ? model
    : "openai/gpt-oss-120b";

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

    const reply =
      response.data?.choices?.[0]?.message?.content ||
      "No response";

    return res.json({
      choices: [
        {
          message: {
            content: reply
          }
        }
      ],
      model_used: selectedModel
    });

  } catch (err) {
    console.log("CHAT ERROR:", err.response?.data || err.message);

    return res.json({
      choices: [
        {
          message: {
            content:
              "⚠️ Error: " +
              (err.response?.data?.error?.message || err.message)
          }
        }
      ]
    });
  }
});

// ─────────────────────────────────────────────────────────────
// ANALYZE IMAGE
// ─────────────────────────────────────────────────────────────

app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;

  if (!image) {
    return res.json({
      choices: [
        {
          message: {
            content: "No image received"
          }
        }
      ]
    });
  }

  for (const model of VISION_MODELS) {
    try {
      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: image
                  }
                },
                {
                  type: "text",
                  text:
                    question ||
                    "Analyze this image in detail."
                }
              ]
            }
          ],
          max_tokens: 2048
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );

      const reply =
        response.data?.choices?.[0]?.message?.content;

      if (reply) {
        return res.json({
          choices: [
            {
              message: {
                content: reply
              }
            }
          ]
        });
      }

    } catch (err) {
      console.log(
        "VISION MODEL FAILED:",
        model,
        err.response?.data || err.message
      );
    }
  }

  res.json({
    choices: [
      {
        message: {
          content: "⚠️ Vision models unavailable."
        }
      }
    ]
  });
});

// ─────────────────────────────────────────────────────────────
// IMAGE GENERATION
// ─────────────────────────────────────────────────────────────

app.post("/image", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.json({
      error: "No prompt received"
    });
  }

  try {
    const encodedPrompt = encodeURIComponent(prompt);

    const imageUrl =
      `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&enhance=true&nologo=true`;

    const imageBuffer = await new Promise((resolve, reject) => {

      function fetchImage(url, redirects = 0) {

        if (redirects > 5) {
          reject(new Error("Too many redirects"));
          return;
        }

        https.get(url, (response) => {

          if (
            response.statusCode === 301 ||
            response.statusCode === 302
          ) {
            return fetchImage(
              response.headers.location,
              redirects + 1
            );
          }

          const chunks = [];

          response.on("data", chunk => chunks.push(chunk));

          response.on("end", () => {
            resolve(Buffer.concat(chunks));
          });

          response.on("error", reject);

        }).on("error", reject);
      }

      fetchImage(imageUrl);
    });

    res.json({
      image:
        `data:image/jpeg;base64,${imageBuffer.toString("base64")}`
    });

  } catch (err) {
    console.log("IMAGE ERROR:", err.message);

    res.json({
      error: "Image generation failed: " + err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────────────────────

app.post("/search", async (req, res) => {
  const { query } = req.body;

  if (!query) {
    return res.json({
      error: "No query provided"
    });
  }

  try {
    const response = await axios.post(
      "https://api.tavily.com/search",
      {
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: true
      },
      {
        timeout: 15000
      }
    );

    const data = response.data;

    const context = (data.results || [])
      .map((r, i) =>
        `[${i + 1}] ${r.title}\n${(r.content || "").slice(0, 500)}\nSource: ${r.url}`
      )
      .join("\n\n");

    return res.json({
      answer: data.answer || "",
      context,
      sources: (data.results || []).map(r => ({
        title: r.title,
        url: r.url
      }))
    });

  } catch (err) {
    console.log("SEARCH ERROR:", err.response?.data || err.message);

    return res.json({
      error:
        "Search failed: " +
        (err.response?.data?.message || err.message)
    });
  }
});

// ─────────────────────────────────────────────────────────────
// SEND CONFIRMATION EMAIL
// ─────────────────────────────────────────────────────────────

app.post("/send-confirmation", async (req, res) => {

  const { email, name } = req.body;

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("EMAIL REQUEST RECEIVED");
  console.log("TO:", email);
  console.log("NAME:", name);

  console.log(
    "GMAIL_USER:",
    process.env.GMAIL_USER ? "✅ OK" : "❌ MISSING"
  );

  console.log(
    "GMAIL_PASS:",
    process.env.GMAIL_PASS ? "✅ OK" : "❌ MISSING"
  );

  if (!email || !name) {
    return res.json({
      success: false,
      error: "Missing email or name"
    });
  }

  const token = crypto.randomBytes(32).toString("hex");

  pendingTokens.set(token, {
    email,
    name,
    expires: Date.now() + 24 * 60 * 60 * 1000
  });

  const confirmLink =
    `${FRONTEND_URL}?confirm=${token}`;

  console.log("CONFIRM LINK:", confirmLink);

  try {

    console.log("CREATING SMTP TRANSPORT...");

   const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

    console.log("VERIFYING SMTP CONNECTION...");

    await transporter.verify();

    console.log("SMTP CONNECTION SUCCESS ✅");

    console.log("SENDING EMAIL...");

    const info = await transporter.sendMail({
      from: `"Nova AI 618" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "✅ Confirm your Nova AI 618 account",
      html: `
      <div style="font-family:Arial;padding:20px;background:#0b0c12;color:white">
        <h1>🌌 Nova AI 618</h1>
        <p>Hello ${name},</p>
        <p>Click below to confirm your account:</p>
        <a href="${confirmLink}"
           style="display:inline-block;padding:12px 24px;background:#7c6aff;color:white;text-decoration:none;border-radius:8px">
           Confirm Account
        </a>
      </div>
      `
    });

    console.log("EMAIL SENT SUCCESS ✅");
    console.log("MESSAGE ID:", info.messageId);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    return res.json({
      success: true,
      messageId: info.messageId
    });

  } catch (err) {

    console.log("❌ EMAIL ERROR");
    console.log("MESSAGE:", err.message);

    if (err.code) {
      console.log("CODE:", err.code);
    }

    if (err.response) {
      console.log("RESPONSE:", err.response);
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    return res.json({
      success: false,
      error: err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────
// VERIFY EMAIL
// ─────────────────────────────────────────────────────────────

app.get("/verify-email", (req, res) => {

  const { token } = req.query;

  if (!token) {
    return res.json({
      success: false,
      error: "No token"
    });
  }

  const data = pendingTokens.get(token);

  if (!data) {
    return res.json({
      success: false,
      error: "Invalid token"
    });
  }

  if (Date.now() > data.expires) {
    pendingTokens.delete(token);

    return res.json({
      success: false,
      error: "Token expired"
    });
  }

  pendingTokens.delete(token);

  return res.json({
    success: true,
    email: data.email,
    name: data.name
  });
});

// ─────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`🚀 Nova AI Server running on port ${PORT}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  console.log("ENVIRONMENT CHECK");

  console.log(
    "GROQ_API_KEY:",
    process.env.GROQ_API_KEY ? "✅" : "❌"
  );

  console.log(
    "TAVILY_API_KEY:",
    process.env.TAVILY_API_KEY ? "✅" : "❌"
  );

  console.log(
    "GMAIL_USER:",
    process.env.GMAIL_USER ? "✅" : "❌"
  );

  console.log(
    "GMAIL_PASS:",
    process.env.GMAIL_PASS ? "✅" : "❌"
  );

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
});
