import express from "express";
import cors from "cors";
import axios from 'axios';

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

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
        model: "llama-3.3-70b-versatile", // Modèle textuel pour le chat
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
    const reply = response.data.choices?.[0]?.message?.content || "Désolé, je n'ai pas pu générer de réponse.";
    res.json({ choices: [{ message: { content: reply } }] });
  } catch (err) {
    console.error("CHAT ERROR:", err.response?.data || err.message);
    res.status(500).json({
      error: "Erreur serveur: " + (err.response?.data?.error?.message || err.message)
    });
  }
});

// --- Génération d'image (Pollinations.ai) ---
app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "Aucune invitation reçue" });
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
    res.status(500).json({ error: "Échec de la génération d'image: " + err.message });
  }
});

// --- Analyse d'image (Pollinations.ai) ---
app.post("/analyze-image", async (req, res) => {
  const { image } = req.body;

  if (!image || !image.startsWith("data:image/")) {
    return res.status(400).json({ error: "Format d'image invalide. Une URL de données est attendue." });
  }

  try {
    // Extraire la partie base64 de la data URL
    const base64Image = image.split(',')[1];

    // Envoyer à Pollinations.ai pour analyse
    const response = await axios.post(
      "https://api.pollinations.ai/describe",
      {
        image: base64Image,
        prompt: "Décris cette image en détail. Que vois-tu ? Sois précis et utilise le français."
      },
      {
        headers: {
          "Content-Type": "application/json"
        },
        timeout: GROQ_TIMEOUT
      }
    );

    const analysis = response.data?.description || "Je n'ai pas pu analyser cette image.";
    res.json({ success: true, analysis });

  } catch (err) {
    console.error("IMAGE ANALYSIS ERROR:", err.response?.data || err.message);
    res.status(500).json({
      success: false,
      error: "Échec de l'analyse d'image: " + (err.response?.data?.error || err.message)
    });
  }
});

// --- Démarrage du serveur ---
app.listen(PORT, () => {
  console.log(`Nova AI Server running on port ${PORT}`);
  console.log(`Endpoints:`);
  console.log(`- GET  /          : Test`);
  console.log(`- POST /chat      : Chat avec Groq (llama-3.3-70b-versatile)`);
  console.log(`- POST /image     : Générer une image (Pollinations.ai)`);
  console.log(`- POST /analyze-image : Analyser une image (Pollinations.ai)`);
});
