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

app.post("/analyze", async (req, res) => {
  const { image, question } = req.body;
  console.log("REPLICATE TOKEN =", process.env.REPLICATE_API_TOKEN ? "OK" : "MISSING");
  console.log("QUESTION =", question);

  if (!image) {
    return res.json({ choices: [{ message: { content: "No image received" } }] });
  }

  try {
    const createRes = await axios.post(
      "https://api.replicate.com/v1/models/yorickvp/llava-13b/predictions",
      {
        input: {
          image: image,
          prompt: question || "Analyze this image in detail. Describe everything you see: objects, colors, context, text if any, and anything relevant.",
          max_tokens: 1024
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
          "Prefer": "wait"
        }
      }
    );

    const prediction = createRes.data;
    console.log("REPLICATE STATUS:", prediction.status);

    if (prediction.status === "succeeded" && prediction.output) {
      const reply = Array.isArray(prediction.output)
        ? prediction.output.join("")
        : prediction.output;
      return res.json({ choices: [{ message: { content: reply } }] });
    }

    const pollUrl = prediction.urls?.get || `https://api.replicate.com/v1/predictions/${prediction.id}`;

    while (true) {
      await new Promise(r => setTimeout(r, 2000));

      const pollRes = await axios.get(pollUrl, {
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`
        }
      });

      const p = pollRes.data;
      console.log("Polling:", p.status);

      if (p.status === "succeeded") {
        const reply = Array.isArray(p.output) ? p.output.join("") : p.output;
        return res.json({ choices: [{ message: { content: reply } }] });
      }

      if (p.status === "failed" || p.status === "canceled") {
        return res.json({
          choices: [{
            message: {
              content: "⚠️ Analysis failed: " + (p.error || "unknown error")
            }
          }]
        });
      }
    }

  } catch (err) {
    console.log("ANALYZE ERROR:", err.response?.data || err.message);
    res.json({
      choices: [{
        message: {
          content: "⚠️ Error during analysis: " + err.message
        }
      }]
    });
  }
});

app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  console.log("IMAGE PROMPT =", prompt);

  if (!prompt) return res.json({ error: "No prompt received" });

  try {
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=768&nologo=true&enhance=true`;
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
    res.json({ image: `data:image/jpeg;base64,${base64}` });

  } catch (err) {
    console.log("IMAGE ERROR:", err.message);
    res.json({ error: "Image generation error: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Nova AI Server running on port ${PORT}`);
});
