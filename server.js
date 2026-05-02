import express from "express";
import cors from "cors";
import axios from 'axios';

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 10000;
const GROQ_TIMEOUT = 30000; // Timeout pour les requêtes Groq (30 secondes)

// --- Test ---
app.get("/", (req, res) => {
  console.log("Test endpoint called");
  res.send("JARVIS AI Server OK 🚀");
});

// --- Chat (Groq) ---
app.post("/chat", async (req, res) => {
  const messages = req.body.messages;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "No messages received" });
  }

  try {
    console.log("Chat request received with model: llama-3.3-70b-versatile");
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: messages,
        temperature: 0.7,
        max_tokens: 4096
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: GROQ_TIMEOUT
      }
    );
    const reply = response.data.choices?.[0]?.message?.content || "AI Error";
    res.json({ choices: [{ message: { content: reply } }] });
  } catch (err) {
    console.error("CHAT ERROR:", err.response?.data || err.message);
    res.status(500).json({
      error: "Server error: " + (err.response?.data?.error?.message || err.message)
    });
  }
});

// --- Génération d'image (Pollinations.ai) ---
app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "No prompt received" });
  }

  try {
    console.log("Generating image for prompt:", prompt);
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=512&nologo=true&quality=0.8`;
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: GROQ_TIMEOUT
    });
    const base64 = Buffer.from(imageResponse.data).toString("base64");
    res.json({ image: `data:image/jpeg;base64,${base64}` });
  } catch (err) {
    console.error("IMAGE GENERATION ERROR:", err.message);
    res.status(500).json({ error: "Image generation failed: " + err.message });
  }
});

// --- Analyse d'image (Groq LLaVA) ---
app.post("/analyze-image", async (req, res) => {
  const { image } = req.body;

  if (!image) {
    return res.status(400).json({ error: "No image received" });
  }

  // Vérifie que l'image est une data URL valide
  if (!image.startsWith("data:image/")) {
    return res.status(400).json({
      error: "Invalid image format. Expected a data URL (e.g., data:image/jpeg;base64,...)."
    });
  }

  try {
    console.log("Analyzing image with model: llava-1.5-7b");

    // ⚠️ CORRECTION : Format exact pour Groq (image_url doit être un objet avec une clé "url")
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llava-1.5-7b",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe this image in detail. What do you see? Be precise and use English."
              },
              {
                type: "image_url",
                image_url: {
                  url: image  // ⚠️ ICI : image_url est un OBJET avec une clé "url"
                }
              }
            ]
          }
        ],
        temperature: 0.7,
        max_tokens: 1024
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: GROQ_TIMEOUT
      }
    );

    const analysis = response.data.choices?.[0]?.message?.content;
    if (!analysis) {
      return res.status(500).json({ error: "No analysis returned from Groq" });
    }

    res.json({ success: true, analysis });

  } catch (err) {
    console.error("IMAGE ANALYSIS ERROR:", err.response?.data || err.message);
    res.status(500).json({
      success: false,
      error: "Image analysis failed: " + (err.response?.data?.error?.message || err.message)
    });
  }
});

// --- Démarrage du serveur ---
app.listen(PORT, () => {
  console.log(`JARVIS AI Server running on port ${PORT}`);
  console.log(`Endpoints:`);
  console.log(`- GET  /          : Test`);
  console.log(`- POST /chat      : Chat with Groq (llama-3.3-70b-versatile)`);
  console.log(`- POST /image     : Generate image (Pollinations.ai)`);
  console.log(`- POST /analyze-image : Analyze image (Groq LLaVA-1.5-7b)`);
});
