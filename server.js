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
          model: "meta-llama/Meta-Llama-3-8B-Instruct",
          messages: messages,
          temperature: 0.7,
          max_tokens: 300
        })
      }
    );

    const data = await response.json();

    const reply =
      data?.choices?.[0]?.message?.content ||
      data?.error?.message ||
      "Erreur IA";

    res.json({
      choices: [{ message: { content: reply } }]
    });

  } catch (err) {
    console.log(err);

    res.json({
      choices: [{ message: { content: "Erreur serveur" } }]
    });
  }
});

app.listen(PORT, () => {
  console.log("Serveur IA en ligne sur port " + PORT);
});
