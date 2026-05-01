import express from "express";
import cors from "cors";
import https from "https";

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

  console.log("GROQ_API_KEY =", process.env.GROQ_API_KEY ? "OK" : "MANQUANT");

  if (!messages) {
    return res.json({
      choices: [{ message: { content: "Aucun message reçu" } }]
    });
  }

  try {
    const data = await new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: messages,
        temperature: 0.7,
        max_tokens: 4096
      });

      const req = https.request({
        hostname: "api.groq.com",
        path: "/openai/v1/chat/completions",
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        }
      }, (response) => {
        let raw = "";
        response.on("data", chunk => raw += chunk);
        response.on("end", () => resolve(JSON.parse(raw)));
      });

      req.on("error", reject);
      req.write(body);
      req.end();
    });

    console.log("GROQ STATUS: OK");

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

// génération d'image — via pollinations.ai (gratuit, sans clé)
app.post("/image", async (req, res) => {
  const { prompt } = req.body;

  console.log("PROMPT =", prompt);

  if (!prompt) {
    return res.json({ error: "Aucun prompt reçu" });
  }

  try {
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=512&nologo=true`;

    console.log("URL image:", imageUrl);

    const imageBuffer = await new Promise((resolve, reject) => {
      https.get(imageUrl, (response) => {
        // Suivre les redirections
        if (response.statusCode === 301 || response.statusCode === 302) {
          console.log("Redirection vers:", response.headers.location);
          https.get(response.headers.location, (res2) => {
            const chunks = [];
            res2.on("data", chunk => chunks.push(chunk));
            res2.on("end", () => resolve(Buffer.concat(chunks)));
            res2.on("error", reject);
          });
          return;
        }

        console.log("STATUS Pollinations:", response.statusCode);
        console.log("CONTENT TYPE:", response.headers["content-type"]);

        const chunks = [];
        response.on("data", chunk => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", reject);
      }).on("error", reject);
    });

    const base64 = imageBuffer.toString("base64");
    res.json({ image: `data:image/jpeg;base64,${base64}` });

  } catch (err) {
    console.log("IMAGE ERROR:", err.message);
    res.json({ error: "Erreur génération image : " + err.message });
  }
});

app.listen(PORT, () => {
  console.log("Serveur IA en ligne sur port " + PORT);
});
