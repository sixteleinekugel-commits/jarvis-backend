import express from "express";
import cors from "cors";
import axios from 'axios';

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 10000;
const GROQ_TIMEOUT = 30000;

// Test
app.get("/", (req, res) => {
  res.send("JARVIS AI Server OK 🚀");
});

// Chat (Groq)
app.post("/chat", async (req, res) => {
  const messages = req.body.messages;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "No messages received" });
  }

  try {
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

// Génération d'image (Pollinations.ai)
app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "No prompt received" });
  }

  try {
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=512&nologo=true`;
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: GROQ_TIMEOUT
    });
    const base64 = Buffer.from(imageResponse.data).toString("base64");
    res.json({ image: `data:image/jpeg;base64,${base64}` });
  } catch (err) {
    console.error("IMAGE ERROR:", err.message);
    res.status(500).json({ error: "Image generation failed: " + err.message });
  }
});

// Analyse d'image (Groq LLaVA) - MODÈLE 100% FONCTIONNEL
app.post("/analyze-image", async (req, res) => {
  const { image } = req.body;

  if (!image || !image.startsWith("data:image/")) {
    return res.status(400).json({ error: "Invalid image format. Expected a data URL." });
  }

  try {
    console.log("Analyzing image with model: llava-13b-v1.1");

    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llava-13b-v1.1", // ✅ MODÈLE MULTIMODAL DISPONIBLE EN MAI 2026
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this image in detail. What do you see?" },
              { type: "image_url", image_url: { url: image } } // Format correct
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
    res.json({ success: true, analysis });

  } catch (err) {
    console.error("IMAGE ANALYSIS ERROR:", err.response?.data || err.message);
    res.status(500).json({
      success: false,
      error: "Image analysis failed: " + (err.response?.data?.error?.message || err.message)
    });
  }
});

// Démarrage
app.listen(PORT, () => {
  console.log(`JARVIS AI Server running on port ${PORT}`);
});
