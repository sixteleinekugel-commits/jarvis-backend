import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

// test
app.get("/", (req, res) => {
  res.send("Serveur IA OK 🚀");
});

// chat
app.post("/chat", async (req, res) => {
  const messages = req.body.messages;

  console.log("GROQ_API_KEY =", process.env.GROQ_API_KEY);

  if (!messages) {
    return res.json({
      choices: [{ message: { content: "Aucun message reçu" } }]
    });
  }

  try {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: messages,
          temperature: 0.7,
          max_tokens: 300
        })
      }
    );

    const data = await response.json();
    console.log("GROQ RESPONSE:", JSON.stringify(data, null, 2));

    if (data.error) {
      return res.json({
        choices: [
          {
            message: {
              content: "Erreur API : " + data.error.message
            }
          }
        ]
      });
    }

    const reply =
      data?.choices?.[0]?.message?.content ||
      "Erreur IA";

    res.json({
      choices: [{ message: { content: reply } }]
    });

  } catch (err) {
    console.log("SERVER ERROR:", err);
    res.json({
      choices: [{ message: { content: "Erreur serveur" } }]
    });
  }
});

// génération d'image
app.post("/image", async (req, res) => {
  const { prompt } = req.body;

  console.log("HF_TOKEN =", process.env.HF_TOKEN);

  if (!prompt) {
    return res.json({ error: "Aucun prompt reçu" });
  }

  try {
    const response = await fetch(
      "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-2-1",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.HF_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ inputs: prompt })
      }
    );

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    res.json({ image: `data:image/jpeg;base64,${base64}` });

  } catch (err) {
    console.log("IMAGE ERROR:", err);
    res.json({ error: "Erreur génération image" });
  }
});

app.listen(PORT, () => {
  console.log("Serveur IA en ligne sur port " + PORT);
});
