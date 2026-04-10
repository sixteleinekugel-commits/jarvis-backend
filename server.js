import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();

app.use(cors());
app.use(express.json());

// clé Hugging Face (à mettre dans Render env variables)
const HF_TOKEN = process.env.HF_TOKEN;

// route test
app.get("/", (req, res) => {
  res.send("Serveur IA actif 🚀");
});

// route chat (FORMAT PRO CHATGPT)
app.post("/chat", async (req, res) => {
  const messages = req.body.messages;

  if (!messages) {
    return res.json({
      choices: [{
        message: { content: "Aucun message reçu" }
      }]
    });
  }

  try {
    const formatted = messages
      .map(m => `${m.role}: ${m.content}`)
      .join("\n");

    const response = await fetch(
      "https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          inputs: formatted,
          parameters: {
            max_new_tokens: 300,
            temperature: 0.7
          }
        })
      }
    );

    const data = await response.json();

    const reply =
      data?.[0]?.generated_text ||
      data?.generated_text ||
      "Erreur IA";

    res.json({
      choices: [
        {
          message: {
            content: reply
          }
        }
      ]
    });

  } catch (err) {
    res.json({
      choices: [
        {
          message: {
            content: "Erreur serveur"
          }
        }
      ]
    });
  }
});

// port Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Serveur IA en ligne sur port " + PORT);
});
