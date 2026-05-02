import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" })); // Augmenté pour les images

const PORT = process.env.PORT || 10000;
const GROQ_TIMEOUT = 30000;

// --- Test ---
app.get("/", (req, res) => {
  res.send("Nova AI Server OK 🚀");
});

// --- Chat (Groq) ---
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

    const reply = response.data.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response.";
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
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=512&nologo=true&quality=0.8`;

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

// --- Analyse d'image (Pollinations.ai) ---
app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;

  if (!image || !image.startsWith("data:image/")) {
    return res.status(400).json({ error: "Invalid image format. Expected a data URL." });
  }

  try {
    // Extraire la partie base64 de la data URL
    const base64Image = image.split(',')[1];

    // Envoyer à Pollinations.ai pour analyse
    const response = await axios.post(
      "https://api.pollinations.ai/describe",
      {
        image: base64Image,
        prompt: question || "Describe this image in detail. What do you see? Be precise and use English."
      },
      {
        headers: {
          "Content-Type": "application/json"
        },
        timeout: GROQ_TIMEOUT
      }
    );

    // Formater la réponse comme Groq pour être compatible avec ton frontend
    const analysis = response.data?.description || "I couldn't analyze this image.";

    res.json({
      choices: [
        {
          message: {
            content: analysis
          }
        }
      ]
    });

  } catch (err) {
    console.error("IMAGE ANALYSIS ERROR:", err.response?.data || err.message);
    res.status(500).json({
      error: "Image analysis failed: " + (err.response?.data?.error || err.message)
    });
  }
});

// --- Démarrage ---
app.listen(PORT, () => {
  console.log(`Nova AI Server running on port ${PORT}`);
  console.log(`Endpoints:`);
  console.log(`- GET  /          : Test`);
  console.log(`- POST /chat      : Chat with Groq`);
  console.log(`- POST /image     : Generate image (Pollinations.ai)`);
  console.log(`- POST /analyze   : Analyze image (Pollinations.ai)`);
});
