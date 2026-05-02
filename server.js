import express from "express";
import cors from "cors";
import https from "https";
import fetch from "node-fetch"; // Nécessaire pour les requêtes vers Groq avec les images

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" })); // Augmente la limite pour les images

const PORT = process.env.PORT || 10000;

// Test
app.get("/", (req, res) => {
  res.send("JARVIS AI Server OK 🚀");
});

// Chat (Groq)
app.post("/chat", async (req, res) => {
  const messages = req.body.messages;

  console.log("GROQ_API_KEY =", process.env.GROQ_API_KEY ? "OK" : "MISSING");

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: "No messages received"
    });
  }

  try {
    const body = JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: messages,
      temperature: 0.7,
      max_tokens: 4096
    });

    const response = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "api.groq.com",
        path: "/openai/v1/chat/completions",
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        }
      }, (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error("Invalid JSON response from Groq"));
          }
        });
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    console.log("GROQ CHAT STATUS: OK");

    if (response.error) {
      return res.status(500).json({
        error: "Groq API error: " + response.error.message
      });
    }

    const reply = response?.choices?.[0]?.message?.content || "AI Error";
    res.json({ choices: [{ message: { content: reply } }] });

  } catch (err) {
    console.error("CHAT ERROR:", err.message);
    res.status(500).json({
      error: "Server error: " + err.message
    });
  }
});

// Génération d'image (Pollinations.ai)
app.post("/image", async (req, res) => {
  const { prompt } = req.body;

  console.log("IMAGE PROMPT =", prompt);

  if (!prompt) {
    return res.status(400).json({ error: "No prompt received" });
  }

  try {
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=512&nologo=true`;

    console.log("Pollinations URL:", imageUrl);

    // Récupère l'image depuis Pollinations
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Pollinations error: ${imageResponse.statusText}`);
    }

    const imageBuffer = await imageResponse.buffer();
    const base64 = imageBuffer.toString("base64");
    res.json({ image: `data:image/jpeg;base64,${base64}` });

  } catch (err) {
    console.error("IMAGE GENERATION ERROR:", err.message);
    res.status(500).json({ error: "Image generation failed: " + err.message });
  }
});

// NOUVEAU: Analyse d'image (via Groq LLaVA-1.5-7B)
app.post("/analyze-image", async (req, res) => {
  const { image } = req.body; // image est un data URL (base64)

  console.log("ANALYZE IMAGE REQUEST RECEIVED");

  if (!image) {
    return res.status(400).json({ error: "No image received" });
  }

  try {
    // Extraire le base64 de l'image (enlever le préfixe data:image/...)
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    // Appel à Groq avec le modèle multimodal LLaVA-1.5-7B
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llava-1.5-7b", // Modèle multimodal de Groq
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
                image_url: image // Groq accepte directement les data URLs
              }
            ]
          }
        ],
        temperature: 0.7,
        max_tokens: 1024
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Groq API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const analysis = data.choices?.[0]?.message?.content || "No analysis available.";

    console.log("IMAGE ANALYSIS SUCCESS");
    res.json({ success: true, analysis });

  } catch (err) {
    console.error("IMAGE ANALYSIS ERROR:", err.message);
    res.status(500).json({
      success: false,
      error: "Image analysis failed: " + err.message
    });
  }
});

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`JARVIS AI Server running on port ${PORT}`);
  console.log(`Endpoints:`);
  console.log(`- GET  /          : Test`);
  console.log(`- POST /chat      : Chat with Groq`);
  console.log(`- POST /image     : Generate image (Pollinations)`);
  console.log(`- POST /analyze-image : Analyze image (Groq LLaVA)`);
});
