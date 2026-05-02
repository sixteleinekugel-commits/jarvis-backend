import express from "express";
import cors from "cors";
import axios from 'axios';

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.send("JARVIS AI Server OK 🚀");
});

app.post("/chat", async (req, res) => {
  const messages = req.body.messages;
  if (!messages) return res.status(400).json({ error: "No messages" });

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
        }
      }
    );
    res.json({ choices: [{ message: { content: response.data.choices[0].message.content } }] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/image", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "No prompt" });

  try {
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true`;
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const base64 = Buffer.from(imageResponse.data).toString("base64");
    res.json({ image: `data:image/jpeg;base64,${base64}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/analyze-image", async (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: "No image" });

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llava-1.5-7b",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Describe this image in detail." },
            { type: "image_url", image_url: image }
          ]
        }],
        temperature: 0.7,
        max_tokens: 1024
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );
    res.json({ success: true, analysis: response.data.choices[0].message.content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
