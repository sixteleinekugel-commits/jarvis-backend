import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 10000;
const GROQ_TIMEOUT = 30000;
const REPLICATE_TIMEOUT = 60000; // Replicate peut prendre plus de temps

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

// --- Analyse d'image (Replicate) ---
app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;

  if (!image || !image.startsWith("data:image/")) {
    return res.status(400).json({ error: "Invalid image format. Expected a data URL." });
  }

  try {
    // Extraire la partie base64 de la data URL
    const base64Image = image.split(',')[1];

    // Envoyer à Replicate pour analyse avec LLaVA-13b
    const response = await axios.post(
      "https://api.replicate.com/v1/predictions",
      {
        version: "b21cbe271e65345e33d81a65b04f4354c52736b56f3b5789990146644595ab25", // LLaVA-13b
        input: {
          image: base64Image,
          prompt: question || "Describe this image in detail. What do you see? Be precise and use English."
        }
      },
      {
        headers: {
          Authorization: `Token ${process.env.REPLICATE_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: REPLICATE_TIMEOUT
      }
    );

    // Récupérer le résultat (Replicate est asynchrone)
    const predictionId = response.data.id;
    let prediction;

    // Attendre que le résultat soit prêt (polling)
    while (true) {
      const predResponse = await axios.get(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        {
          headers: {
            Authorization: `Token ${process.env.REPLICATE_API_KEY}`
          },
          timeout: REPLICATE_TIMEOUT
        }
      );

      prediction = predResponse.data;

      if (prediction.status === "succeeded") {
        break;
      } else if (prediction.status === "failed") {
        throw new Error(prediction.error || "Prediction failed");
      }

      // Attendre 1 seconde avant de vérifier à nouveau
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Formater la réponse comme Groq pour être compatible avec ton frontend
    const analysis = prediction.output?.join(" ") || "I couldn't analyze this image.";

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
  console.log(`- POST /analyze   : Analyze image (Replicate LLaVA-13b)`);
});
