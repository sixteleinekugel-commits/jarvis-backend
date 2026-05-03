import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 10000;

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

async function replicateRun(modelUrl, input) {
  const token = process.env.REPLICATE_API_TOKEN;
  console.log("REPLICATE TOKEN =", token ? "OK" : "MISSING");

  const createRes = await axios.post(
    modelUrl,
    { input },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Prefer": "wait=60"
      }
    }
  );

  const prediction = createRes.data;
  console.log("REPLICATE STATUS:", prediction.status);

  if (prediction.status === "succeeded" && prediction.output) {
    return prediction.output;
  }

  const pollUrl = `https://api.replicate.com/v1/predictions/${prediction.id}`;

  while (true) {
    await new Promise(r => setTimeout(r, 2000));

    const pollRes = await axios.get(pollUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const p = pollRes.data;
    console.log("Polling:", p.status);

    if (p.status === "succeeded") return p.output;
    if (p.status === "failed" || p.status === "canceled") {
      throw new Error(p.error || "Prediction failed");
    }
  }
}

app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;
  console.log("ANALYZE — question:", question);

  if (!image) {
    return res.json({ choices: [{ message: { content: "No image received" } }] });
  }

  try {
    const output = await replicateRun(
      "https://api.replicate.com/v1/models/yorickvp/llava-13b/predictions",
      {
        image: image,
        prompt: question || "Analyze this image in detail. Describe everything you see: objects, colors, context, text if any, and anything relevant.",
        max_tokens: 1024
      }
    );

    const reply = Array.isArray(output) ? output.join("") : output;
    res.json({ choices: [{ message: { content: reply } }] });

  } catch (err) {
    console.log("ANALYZE ERROR:", err.response?.data || err.message);
    res.json({ choices: [{ message: { content: "⚠️ Analysis error: " + err.message } }] });
  }
});

app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  console.log("IMAGE PROMPT =", prompt);

  if (!prompt) return res.json({ error: "No prompt received" });

  try {
    const output = await replicateRun(
      "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
      {
        prompt: prompt,
        num_outputs: 1,
        aspect_ratio: "1:1",
        output_format: "jpg",
        output_quality: 90
      }
    );

    const imageUrl = Array.isArray(output) ? output[0] : output;
    console.log("IMAGE URL:", imageUrl);
    res.json({ image: imageUrl });

  } catch (err) {
    console.log("IMAGE ERROR:", err.response?.data || err.message);
    res.json({ error: "Image generation error: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Nova AI Server running on port ${PORT}`);
});
