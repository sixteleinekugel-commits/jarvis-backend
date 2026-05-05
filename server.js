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

// ── Recherche Web (Tavily) ──────────────────────────────────
app.post("/search", async (req, res) => {
  const { query } = req.body;
  console.log("SEARCH QUERY =", query);
  
  if (!query) return res.json({ error: "No query" });

  try {
    const searchRes = await axios.post(
      "https://api.tavily.com/search",
      {
        api_key: process.env.TAVILY_API_KEY,
        query: query,
        search_depth: "basic",
        max_results: 5,
        include_answer: true
      },
      { headers: { "Content-Type": "application/json" } }
    );

    const data = searchRes.data;
    
    // Construction du contexte pour l'envoyer à l'IA si besoin
    const context = data.results.map((r, i) => 
      `[${i+1}] ${r.title}\n${r.content}\nSource: ${r.url}`
    ).join("\n\n");

    res.json({
      answer: data.answer || "Voici ce que j'ai trouvé sur le web :",
      context: context,
      sources: data.results.map(r => ({ title: r.title, url: r.url }))
    });

  } catch (err) {
    console.error("TAVILY ERROR:", err.response?.data || err.message);
    res.status(500).json({ error: "Erreur lors de la recherche web" });
  }
});

// ── Fallback HuggingFace ────────────────────────────────────
async function hfFallback(messages) {
  console.log("Switching to HuggingFace fallback...");
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
      parameters: { max_new_tokens: 1024, temperature: 0.7, return_full_text: false }
    },
    {
      headers: { Authorization: `Bearer ${process.env.HF_TOKEN}`, "Content-Type": "application/json" },
      timeout: 60000
    }
  );

  const data = response.data;
  const text = Array.isArray(data) ? data[0]?.generated_text : data?.generated_text;
  if (!text) throw new Error("No text from HuggingFace");
  return text.includes("<|assistant|>") ? text.split("<|assistant|>").pop().trim() : text.trim();
}

// ── Chat (Groq + fallback HF) ───────────────────────────────
app.post("/chat", async (req, res) => {
  const { messages } = req.body;

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

    const reply = response.data?.choices?.[0]?.message?.content || "AI Error";
    return res.json({ choices: [{ message: { content: reply } }] });

  } catch (groqErr) {
    const status = groqErr.response?.status;
    const errMsg = groqErr.response?.data?.error?.message || groqErr.message;
    
    const shouldFallback = status === 429 || status === 413 || status === 503 || errMsg.toLowerCase().includes("limit");

    if (!shouldFallback) return res.json({ choices: [{ message: { content: "⚠️ Error: " + errMsg } }] });

    try {
      const reply = await hfFallback(messages);
      return res.json({ choices: [{ message: { content: reply } }], fallback: true });
    } catch (hfErr) {
      return res.json({ choices: [{ message: { content: "⚠️ Services indisponibles." } }] });
    }
  }
});

// ── Analyse d'image (Groq Vision) ──────────────────────────
app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;
  if (!image) return res.json({ error: "No image received" });

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.2-11b-vision-preview", // Modèle vision stable
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: image } },
              { type: "text", text: question || "Analyze this image." }
            ]
          }
        ]
      },
      { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } }
    );
    res.json({ choices: [{ message: { content: response.data.choices[0].message.content } }] });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ── Génération d'image (Pollinations) ──────────────────────
app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.json({ error: "No prompt" });

  try {
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&enhance=true&model=flux`;
    
    // On peut renvoyer directement l'URL ou le base64 comme avant
    res.json({ image: imageUrl }); 
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Nova AI Server running on port ${PORT}`);
});
