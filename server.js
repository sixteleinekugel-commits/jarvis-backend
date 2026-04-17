import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

const HF_TOKEN = process.env.HF_TOKEN;

// route test
app.get("/", (req, res) => {
  res.send("Serveur IA OK 🚀");
});

// route chat
app.post("/chat", async (req, res) => {
  const messages = req.body.messages;

  if (!messages) {
    return res.json({
      choices: [
        {
          message: {
            content: "Aucun message reçu"
          }
        }
      ]
    });
  }

  try {
    const response = await fetch(
      "https://router.huggingface.co/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "meta-llama/Meta-Llama-3.1-70B-Instruct",
          messages: messages,
          temperature: 0.7,
          max_tokens: 300
        })
      }
    );

    const data = await response.json();

    console.log("HF RESPONSE:", JSON.stringify(data, null, 2));

    const reply =
      data?.choices?.[0]?.message?.content ||
      data?.error?.message ||
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
    console.log("SERVER ERROR:", err);

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

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Serveur IA en ligne sur port " + PORT);
});
