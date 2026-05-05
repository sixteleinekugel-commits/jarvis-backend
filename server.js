import express from "express";
import cors from "cors";
import axios from "axios";
import https from "https";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.send("Nova AI Server OK 🚀");
});

// ── Fallback HuggingFace ────────────────────────────────────
async function hfFallback(messages) {
  console.log("Switching to HuggingFace fallback...");

  // Convertir le tableau messages en prompt texte
  const prompt = messages.map(m => {
    if (m.role === "system") return `<|system|>\n${m.content}`;
    if (m.role === "user") return `<|user|>\n${m.content}`;
    if (m.role === "assistant") return `<|assistant|>\n${m.content}`;
    return m.content;
  }).join("\n") + "\n<|assistant|>\n";

  const response = await axios.post(
    "https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3-8B-Instruct",
    {
      inputs: prompt,
      parameters: {
        max_new_tokens: 1024,
        temperature: 0.7,
        return_full_text: false
      }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
        "Content-Type": "application/json"
      },
      timeout: 60000
    }
  );

  const data = response.data;
  console.log("HF RAW RESPONSE:", JSON.stringify(data).slice(0, 200));

  // HF renvoie un tableau
  const text = Array.isArray(data)
    ? data[0]?.generated_text
    : data?.generated_text;

  if (!text) throw new Error("No text from HuggingFace");

  // Nettoyer si le modèle répète le prompt
  const cleaned = text.includes("<|assistant|>")
    ? text.split("<|assistant|>").pop().trim()
    : text.trim();

  return cleaned;
}

// ── Chat (Groq + fallback HF) ───────────────────────────────
app.post("/chat", async (req, res) => {
  const { messages } = req.body;
  console.log("GROQ_API_KEY =", process.env.GROQ_API_KEY ? "OK" : "MISSING");
  console.log("HF_TOKEN =", process.env.HF_TOKEN ? "OK" : "MISSING");

  if (!messages) {
    return res.json({ choices: [{ message: { content: "No message received" } }] });
  }

  // ── Essai Groq ────────────────────────────────────────────
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
        }
      }
    );

    const data = response.data;
    if (data.error) throw new Error(data.error.message);

    const reply = data?.choices?.[0]?.message?.content || "AI Error";
    console.log("Groq OK");
    return res.json({ choices: [{ message: { content: reply } }] });

  } catch (groqErr) {
    const status = groqErr.response?.status;
    const errMsg = groqErr.response?.data?.error?.message || groqErr.message;
    console.log("GROQ ERROR:", status, errMsg);

    // Switch HF si rate limit (429) ou quota dépassé (413, 503)
    const shouldFallback = status === 429 || status === 413 || status === 503
      || errMsg.toLowerCase().includes("rate limit")
      || errMsg.toLowerCase().includes("quota")
      || errMsg.toLowerCase().includes("limit");

    if (!shouldFallback) {
      return res.json({ choices: [{ message: { content: "⚠️ Error: " + errMsg } }] });
    }

    // ── Fallback HuggingFace ──────────────────────────────
    try {
      const reply = await hfFallback(messages);
      console.log("HF fallback OK");
      return res.json({
        choices: [{ message: { content: reply } }],
        fallback: true,
        fallback_model: "meta-llama/Meta-Llama-3-8B-Instruct"
      });
    } catch (hfErr) {
      console.log("HF ERROR:", hfErr.message);
      return res.json({
        choices: [{
          message: {
            content: "⚠️ Both Groq and HuggingFace are unavailable. Please try again later.\n\nGroq: " + errMsg + "\nHF: " + hfErr.message
          }
        }]
      });
    }
  }
});

// ── Analyse d'image (Groq Vision) ──────────────────────────
app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;
  console.log("GROQ VISION — question:", question);

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

    const reply = response.data?.choices?.[0]?.message?.content || "Could not analyze image";
    res.json({ choices: [{ message: { content: reply } }] });

  } catch (err) {
    console.log("ANALYZE ERROR:", err.response?.data || err.message);
    res.json({ choices: [{ message: { content: "⚠️ Analysis error: " + err.message } }] });
  }
});

// ── Génération d'image (Pollinations) ──────────────────────
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
