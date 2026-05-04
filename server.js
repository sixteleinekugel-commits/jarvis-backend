import express from "express";
import cors from "cors";
import axios from "axios";
import https from "https";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 10000;

// ✅ Fonction pour estimer le nombre de tokens (1 token ≈ 4 caractères en moyenne)
function estimateTokenCount(text) {
  return Math.ceil(text.length / 4);
}

// ✅ Limites des modèles
const MODEL_LIMITS = {
  "llama-3.3-70b-versatile": 8192,  // Limite de Groq
  "meta-llama/llama-4-scout-17b-16e-instruct": 2048,  // Limite pour l'analyse d'images
  "meta-llama/Meta-Llama-3-8B-Instruct": 4096  // Limite de Hugging Face
};

app.get("/", (req, res) => {
  res.send("Nova AI Server OK 🚀");
});

// ✅ Endpoint /chat avec basculement automatique
app.post("/chat", async (req, res) => {
  const { messages } = req.body;
  console.log("GROQ_API_KEY =", process.env.GROQ_API_KEY ? "OK" : "MISSING");

  if (!messages || !Array.isArray(messages)) {
    return res.json({ choices: [{ message: { content: "No message received" } }] });
  }

  try {
    // ✅ 1. Estime le nombre total de tokens dans la conversation
    const totalTokens = messages.reduce((count, message) => {
      return count + estimateTokenCount(message.content);
    }, 0);

    console.log(`Total estimated tokens: ${totalTokens}`);

    // ✅ 2. Si la limite de Groq est atteinte, utilise Hugging Face
    if (totalTokens > MODEL_LIMITS["llama-3.3-70b-versatile"] - 1000) { // Marge de sécurité
      console.log("Token limit reached, switching to Hugging Face Meta-Llama-3-8B-Instruct...");

      if (!process.env.HUGGINGFACE_API_KEY) {
        return res.json({ choices: [{ message: { content: "Error: Hugging Face API key not configured." } }] });
      }

      const response = await axios.post(
        "https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3-8B-Instruct/v1/chat/completions",
        {
          messages: messages,
          temperature: 0.7,
          max_tokens: MODEL_LIMITS["meta-llama/Meta-Llama-3-8B-Instruct"],
          stream: false
        },
        {
          headers: {
            "Authorization": `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );

      const data = response.data;
      if (data.error) {
        return res.json({ choices: [{ message: { content: `Hugging Face Error: ${data.error.message || "Unknown error"}` } }] });
      }

      const reply = data.choices?.[0]?.message?.content || "AI Error";
      return res.json({
        choices: [{
          message: {
            content: `[Model: Meta-Llama-3-8B-Instruct (Hugging Face)]\n\n${reply}`
          }
        }]
      });
    }

    // ✅ 3. Sinon, utilise Groq
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: messages,
        temperature: 0.7,
        max_tokens: MODEL_LIMITS["llama-3.3-70b-versatile"]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const data = response.data;
    if (data.error) {
      return res.json({ choices: [{ message: { content: `Groq API Error: ${data.error.message || "Unknown error"}` } }] });
    }

    const reply = data?.choices?.[0]?.message?.content || "AI Error";
    return res.json({ choices: [{ message: { content: reply } }] });

  } catch (err) {
    console.log("CHAT ERROR:", err.message);

    // ✅ 4. Fallback vers Hugging Face si Groq échoue (429, 400, 500, etc.)
    if (err.response?.status === 429 || err.response?.status === 400 || err.response?.status === 500) {
      console.log("Groq error, trying Hugging Face fallback...");

      if (!process.env.HUGGINGFACE_API_KEY) {
        return res.json({ choices: [{ message: { content: "Error: All AI services are currently unavailable. Please try again later." } }] });
      }

      try {
        const fallbackResponse = await axios.post(
          "https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3-8B-Instruct/v1/chat/completions",
          {
            messages: messages,
            temperature: 0.7,
            max_tokens: MODEL_LIMITS["meta-llama/Meta-Llama-3-8B-Instruct"]
          },
          {
            headers: {
              "Authorization": `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
              "Content-Type": "application/json"
            }
          }
        );

        const fallbackData = fallbackResponse.data;
        if (fallbackData.error) {
          return res.json({ choices: [{ message: { content: `Fallback Error: ${fallbackData.error.message || "Unknown error"}` } }] });
        }

        const reply = fallbackData.choices?.[0]?.message?.content || "AI Error";
        return res.json({
          choices: [{
            message: {
              content: `[Fallback: Meta-Llama-3-8B-Instruct (Hugging Face)]\n\n${reply}`
            }
          }]
        });
      } catch (fallbackErr) {
        console.log("Fallback error:", fallbackErr.message);
        return res.json({ choices: [{ message: { content: "All AI services are currently unavailable. Please try again later." } }] });
      }
    }

    // ✅ Erreur inconnue
    return res.json({ choices: [{ message: { content: "Server error: " + err.message } }] });
  }
});

// ✅ Endpoint /analyze (inchangé, mais avec gestion d'erreur améliorée)
app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;
  console.log("GROQ VISION — question:", question);
  console.log("GROQ_API_KEY =", process.env.GROQ_API_KEY ? "OK" : "MISSING");

  if (!image) {
    return res.json({ choices: [{ message: { content: "No image received" } }] });
  }

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: image }
              },
              {
                type: "text",
                text: question || "Analyze this image in detail. Describe everything you see: objects, colors, context, text if any, and anything relevant."
              }
            ]
          }
        ],
        max_tokens: MODEL_LIMITS["meta-llama/llama-4-scout-17b-16e-instruct"],
        temperature: 0.7
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const reply = response.data?.choices?.[0]?.message?.content || "Could not analyze image";
    console.log("VISION REPLY:", reply.slice(0, 100));
    return res.json({ choices: [{ message: { content: reply } }] });

  } catch (err) {
    console.log("ANALYZE ERROR:", err.response?.data || err.message);

    // ✅ Fallback vers Hugging Face pour l'analyse d'images (si disponible)
    if (err.response?.status === 429 || err.response?.status === 400 || err.response?.status === 500) {
      console.log("Groq vision error, trying Hugging Face fallback...");

      if (!process.env.HUGGINGFACE_API_KEY) {
        return res.json({ choices: [{ message: { content: "⚠️ Analysis error: All services are busy. Please try again later." } }] });
      }

      try {
        // Note: Hugging Face ne supporte pas encore l'analyse d'images avec Meta-Llama-3-8B-Instruct
        // Tu peux utiliser un autre modèle comme "llava-hf/llava-1.5-7b-hf" si nécessaire
        return res.json({ choices: [{ message: { content: "⚠️ Image analysis is temporarily unavailable. Please try again later." } }] });
      } catch (fallbackErr) {
        console.log("Fallback analyze error:", fallbackErr.message);
        return res.json({ choices: [{ message: { content: "⚠️ Analysis error: " + err.message } }] });
      }
    }

    return res.json({ choices: [{ message: { content: "⚠️ Analysis error: " + err.message } }] });
  }
});

// ✅ Endpoint /image (inchangé)
app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  console.log("IMAGE PROMPT =", prompt);

  if (!prompt) return res.json({ error: "No prompt received" });

  try {
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&enhance=true&model=flux`;
    console.log("Pollinations URL:", imageUrl);

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
    return res.json({ image: `data:image/jpeg;base64,${base64}` });

  } catch (err) {
    console.log("IMAGE ERROR:", err.message);
    return res.json({ error: "Image generation error: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Nova AI Server running on port ${PORT}`);
});
