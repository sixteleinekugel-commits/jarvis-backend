import express from "express";
import cors from "cors";
import axios from "axios";
import https from "https";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 10000;

// Modèles vision à essayer dans l'ordre
const VISION_MODELS = [
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "llava-v1.5-7b-4096-preview",
  "llama-3.2-11b-vision-preview",
  "llama-3.2-90b-vision-preview"
];

app.get("/", (req, res) => {
  res.send("Nova AI Server OK 🚀");
});

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
        max_tokens: 2048
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
      return res.json({ choices: [{ message: { content: "API Error: " + data.error.message } }] });
    }

    const reply = data?.choices?.[0]?.message?.content || "AI Error";
    res.json({ choices: [{ message: { content: reply } }] });

  } catch (err) {
    console.log("CHAT ERROR:", err.message);
    res.json({ choices: [{ message: { content: "Server error: " + err.message } }] });
  }
});

app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;
  console.log("GROQ VISION — question:", question);
  console.log("GROQ_API_KEY =", process.env.GROQ_API_KEY ? "OK" : "MISSING");

  if (!image) {
    return res.json({ choices: [{ message: { content: "No image received" } }] });
  }

  // Essaie chaque modèle vision jusqu'à ce qu'un fonctionne
  for (const model of VISION_MODELS) {
    try {
      console.log(`Trying vision model: ${model}`);

      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model,
          messages: [
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: image } },
                {
                  type: "text",
                  text: question || "Analyze this image in detail. Describe what you see, key elements, colors, context, and anything relevant."
                }
              ]
            }
          ],
          max_tokens: 2048,
          temperature: 0.7
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );

      const reply = response.data?.choices?.[0]?.message?.content;
      if (reply) {
        console.log(`Vision OK with ${model}:`, reply.slice(0, 100));
        return res.json({ choices: [{ message: { content: reply } }] });
      }

    } catch (err) {
      const errMsg = err.response?.data?.error?.message || err.message;
      console.log(`Model ${model} failed:`, errMsg);
      // Passe au modèle suivant
      continue;
    }
  }

  // Tous les modèles ont échoué
  res.json({ choices: [{ message: { content: "⚠️ Image analysis unavailable. Please enable a vision model at console.groq.com/settings/project/limits" } }] });
});

app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  console.log("IMAGE PROMPT =", prompt);

  if (!prompt) return res.json({ error: "No prompt received" });

  try {
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&enhance=true&model=flux`;

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
    res.json({ image: `data:image/jpeg;base64,${base64}` });

  } catch (err) {
    console.log("IMAGE ERROR:", err.message);
    res.json({ error: "Image generation error: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Nova AI Server running on port ${PORT}`);
});
