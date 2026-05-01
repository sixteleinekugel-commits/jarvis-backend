import express from "express";
import cors from "cors";
import axios from "axios";

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
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: messages,
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

    const data = response.data;
    console.log("GROQ RESPONSE:", JSON.stringify(data, null, 2));

    if (data.error) {
      return res.json({
        choices: [{ message: { content: "Erreur API : " + data.error.message } }]
      });
    }

    const reply = data?.choices?.[0]?.message?.content || "Erreur IA";
    res.json({ choices: [{ message: { content: reply } }] });

  } catch (err) {
    console.log("SERVER ERROR:", err.message);
    res.json({ choices: [{ message: { content: "Erreur serveur : " + err.message } }] });
  }
});

// génération d'image
app.post("/image", async (req, res) => {
  const { prompt } = req.body;

  console.log("HF_TOKEN =", process.env.HF_TOKEN);
  console.log("PROMPT =", prompt);

  if (!prompt) {
    return res.json({ error: "Aucun prompt reçu" });
  }

  try {
    console.log("Appel Hugging Face en cours...");

    const response = await axios.post(
      "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0",
      {
        inputs: prompt,
        options: { wait_for_model: true }
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.HF_TOKEN}`,
          "Content-Type": "application/json"
        },
        responseType: "arraybuffer",
        timeout: 60000
      }
    );

    console.log("STATUS HF:", response.status);
    console.log("CONTENT TYPE:", response.headers["content-type"]);

    const base64 = Buffer.from(response.data).toString("base64");
    res.json({ image: `data:image/png;base64,${base64}` });

  } catch (err) {
    console.log("IMAGE ERROR STATUS:", err.response?.status);
    console.log("IMAGE ERROR:", err.message);

    if (err.response) {
      const errText = Buffer.from(err.response.data).toString("utf8");
      console.log("HF ERROR BODY:", errText);
      return res.json({ error: "Hugging Face erreur : " + errText });
    }

    res.json({ error: "Erreur génération image : " + err.message });
  }
});

app.listen(PORT, () => {
  console.log("Serveur IA en ligne sur port " + PORT);
});
