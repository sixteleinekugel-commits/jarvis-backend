import express from "express";
import cors from "cors";
import axios from "axios";
import https from "https";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 10000;

// --- Test ---
app.get("/", (req, res) => {
  res.send("Nova AI Server OK 🚀");
});

// --- Chat (Groq) ---
app.post("/chat", async (req, res) => {
  const { messages } = req.body;
  console.log("GROQ_API_KEY =", process.env.GROQ_API_KEY ? "OK" : "MISSING");

  if (!messages) {
    return res.json({ choices: [{ message: { content: "No message received" } }] });
  }

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages,
        temperature: 0.7,
        max_tokens: 8192
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );

    const data = response.data;
    if (data.error) {
      return res.json({ choices: [{ message: { content: "API Error: " + data.error.message } }] });
    }

    const reply = data?.choices?.[0]?.message?.content || "AI Error";
    res.json({ choices: [{ message: { content: reply } }] });

  } catch (err) {
    console.log("CHAT ERROR:", err.message);
    res.json({ choices: [{ message: { content: "Server error: " + err.message } }] });
  }
});

// --- Analyse d'image (Replicate LLaVA-13b + Pollinations.ai fallback) ---
app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;
  console.log("REPLICATE TOKEN =", process.env.REPLICATE_API_TOKEN ? "OK" : "MISSING");

  if (!image) {
    return res.json({ choices: [{ message: { content: "No image received" } }] });
  }

  try {
    // ✅ 1. Essayer d'abord avec Replicate (LLaVA-13b)
    try {
      const createRes = await axios.post(
        "https://api.replicate.com/v1/models/yorickvp/llava-13b/predictions",
        {
          input: {
            image: image,
            prompt: question || "Analyze this image in detail. Describe everything you see: objects, colors, context, text if any, and anything relevant.",
            max_tokens: 2048
          }
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json"
          },
          timeout: 60000
        }
      );

      const prediction = createRes.data;
      console.log("REPLICATE STATUS:", prediction.status);

      if (prediction.status === "succeeded" && prediction.output) {
        const reply = Array.isArray(prediction.output) ? prediction.output.join("") : prediction.output;
        return res.json({ choices: [{ message: { content: reply } }] });
      }

      // Polling si nécessaire
      const pollUrl = `https://api.replicate.com/v1/predictions/${prediction.id}`;
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const pollRes = await axios.get(pollUrl, {
          headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` }
        });
        const p = pollRes.data;
        console.log("Polling:", p.status);

        if (p.status === "succeeded") {
          const reply = Array.isArray(p.output) ? p.output.join("") : p.output;
          return res.json({ choices: [{ message: { content: reply } }] });
        }
        if (p.status === "failed" || p.status === "canceled") {
          throw new Error(p.error || "Prediction failed");
        }
      }
      throw new Error("Replicate timeout");
    } catch (replicateErr) {
      console.log("Replicate failed, falling back to Pollinations:", replicateErr.message);
    }

    // ✅ 2. Fallback vers Pollinations.ai
    const base64Image = image.split(',')[1];
    const response = await axios.post(
      "https://api.pollinations.ai/describe",
      { image: base64Image, prompt: question || "Describe this image in detail." },
      { headers: { "Content-Type": "application/json" }, timeout: 30000 }
    );
    const analysis = response.data?.description || "I couldn't analyze this image.";
    return res.json({ choices: [{ message: { content: analysis } }] });

  } catch (err) {
    console.log("ANALYZE ERROR:", err.message);
    res.json({ choices: [{ message: { content: "⚠️ Error: " + err.message } }] });
  }
});

// --- Génération d'image (Fal.ai flux/schnell + Pollinations.ai fallback) ---
app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  console.log("IMAGE PROMPT =", prompt);

  if (!prompt) return res.json({ error: "No prompt received" });

  try {
    // ✅ 1. Essayer d'abord avec Fal.ai (flux/schnell - CORRIGÉ 2026)
    try {
      const response = await axios.post(
        "https://fal.run/fal-ai/flux/schnell",  // ✅ Endpoint CORRIGÉ
        {
          prompt: prompt,
          sync: true,  // Attendre la réponse immédiatement
          // Paramètres optionnels pour FLUX :
          // width: 1024,
          // height: 1024,
          // num_inference_steps: 30,
          // guidance_scale: 7.5
        },
        {
          headers: {
            Authorization: `Key ${process.env.FAL_API_KEY}`,
            "Content-Type": "application/json"
          },
          timeout: 30000
        }
      );

      // Fal.ai retourne l'image en base64 dans response.data
      if (response.data) {
        // Cas 1: Réponse directe en base64
        if (typeof response.data === 'string' && response.data.startsWith('data:image/')) {
          return res.json({ image: response.data });
        }
        // Cas 2: Réponse avec un tableau d'images
        else if (response.data.images && Array.isArray(response.data.images) && response.data.images[0]) {
          const base64Image = response.data.images[0];
          return res.json({ image: `data:image/jpeg;base64,${base64Image}` });
        }
        // Cas 3: Réponse avec un objet contenant l'image
        else if (response.data.image) {
          const base64Image = response.data.image;
          return res.json({ image: `data:image/jpeg;base64,${base64Image}` });
        } else {
          throw new Error("Unexpected Fal.ai response format: " + JSON.stringify(response.data));
        }
      } else {
        throw new Error("No image in Fal.ai response");
      }

    } catch (falErr) {
      console.log("Fal.ai failed (using Pollinations fallback):", falErr.message);
      // Si Fal.ai échoue (404, 401, 429, timeout), on passe à Pollinations
    }

    // ✅ 2. Fallback vers Pollinations.ai (100% gratuit)
    console.log("Using Pollinations.ai fallback...");
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=768&nologo=true&enhance=true`;
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000
    });
    const base64 = Buffer.from(imageResponse.data).toString("base64");
    return res.json({ image: `data:image/jpeg;base64,${base64}` });

  } catch (err) {
    console.log("IMAGE ERROR:", err.message);
    res.json({ error: "Image generation error: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Nova AI Server running on port ${PORT}`);
  console.log(`Endpoints:`);
  console.log(`- GET  /          : Test`);
  console.log(`- POST /chat      : Chat with Groq (llama-3.3-70b-versatile)`);
  console.log(`- POST /image     : Generate image (Fal.ai flux/schnell + Pollinations.ai fallback)`);
  console.log(`- POST /analyze   : Analyze image (Replicate LLaVA-13b + Pollinations.ai fallback)`);
});
