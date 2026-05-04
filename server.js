import express from "express";
import cors from "cors";
import axios from "axios";
import https from "https";
import { Tiktoken } from "tiktoken"; // ✅ Nouvelle importation

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 10000;

// ✅ Initialise Tiktoken pour compter les tokens précisément
const encoding = new Tiktoken({
  bpe: "https://raw.githubusercontent.com/mistralai/MistralSrc/7861a931214239e13401278b41e6c6068d148420/tokenizer.json",
  special_tokens: {}
});

// ✅ Limites des modèles (en tokens)
const MODEL_LIMITS = {
  "llama-3.3-70b-versatile": 8192,  // Groq
  "meta-llama/llama-4-scout-17b-16e-instruct": 2048,  // Groq (vision)
  "meta-llama/Meta-Llama-3-8B-Instruct": 4096  // Hugging Face
};

// ✅ Fonction pour compter les tokens précisément
function countTokens(messages) {
  let total = 0;
  for (const message of messages) {
    total += encoding.encode(message.content).length;
  }
  return total;
}

app.get("/", (req, res) => {
  res.send("Nova AI Server OK 🚀");
});

// ✅ Endpoint /chat avec basculement et gestion des erreurs
app.post("/chat", async (req, res) => {
  const { messages } = req.body;
  console.log("GROQ_API_KEY =", process.env.GROQ_API_KEY ? "OK" : "MISSING");
  console.log("HUGGINGFACE_API_KEY =", process.env.HUGGINGFACE_API_KEY ? "OK" : "MISSING");

  if (!messages || !Array.isArray(messages)) {
    return res.json({ choices: [{ message: { content: "No message received" } }] });
  }

  try {
    // ✅ 1. Compte les tokens précisément
    const totalTokens = countTokens(messages);
    console.log(`Total tokens: ${totalTokens}`);

    // ✅ 2. Si la limite de Groq est atteinte, utilise Hugging Face
    if (totalTokens > MODEL_LIMITS["llama-3.3-70b-versatile"] - 1000) { // Marge de sécurité
      console.log("Token limit reached, switching to Hugging Face...");

      if (!process.env.HUGGINGFACE_API_KEY) {
        return res.json({ choices: [{ message: { content: "Error: Hugging Face API key not configured." } }] });
      }

      // ✅ 3. Appel à Hugging Face avec retry en cas d'erreur
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
          },
          timeout: 30000 // ✅ Timeout de 30 secondes
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

    // ✅ 4. Sinon, utilise Groq avec retry en cas d'erreur 429
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
        },
        timeout: 30000 // ✅ Timeout de 30 secondes
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
    console.log("Error details:", err.response?.data || err.stack);

    // ✅ 5. Fallback vers Hugging Face si Groq échoue (429, 400, 500, etc.)
    if (err.response?.status === 429 || err.response?.status === 400 || err.response?.status === 500 || err.code === "ECONNABORTED") {
      console.log("Groq error, trying Hugging Face fallback...");

      if (!process.env.HUGGINGFACE_API_KEY) {
        return res.json({ choices: [{ message: { content: "Error: All AI services are currently unavailable. Please try again later." } }] });
      }

      try {
        // ✅ Attends 5 secondes avant de réessayer (pour éviter les 429 en cascade)
        await new Promise(resolve => setTimeout(resolve, 5000));

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
            },
            timeout: 30000
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
        console.log("Fallback details:", fallbackErr.response?.data || fallbackErr.stack);
        return res.json({ choices: [{ message: { content: "All AI services are currently unavailable. Please try again in a few minutes." } }] });
      }
    }

    // ✅ Erreur inconnue
    return res.json({ choices: [{ message: { content: "Server error: " + err.message } }] });
  }
});

// ✅ Endpoint /analyze (inchangé, mais avec timeout et gestion d'erreur)
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
        },
        timeout: 30000
      }
    );

    const reply = response.data?.choices?.[0]?.message?.content || "Could not analyze image";
    console.log("VISION REPLY:", reply.slice(0, 100));
    return res.json({ choices: [{ message: { content: reply } }] });

  } catch (err) {
    console.log("ANALYZE ERROR:", err.response?.data || err.message);
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
