import express from "express";
import cors from "cors";
import https from "https";
import http from "http";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

// Fonction fetch maison avec https natif
function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === "https:";
    const lib = isHttps ? https : http;

    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || "GET",
      headers: options.headers || {}
    };

    const req = lib.request(reqOptions, (res) => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          buffer,
          text: () => buffer.toString("utf8"),
          json: () => JSON.parse(buffer.toString("utf8"))
        });
      });
    });

    req.on("error", reject);

    if (options.body) {
      req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    }

    req.end();
  });
}

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
    const response = await fetchJson(
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
          max_tokens: 1024
        })
      }
    );

    const data = response.json();
    console.log("GROQ STATUS:", response.status);

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

  console.log("HF_TOKEN =", process.env.HF_TOKEN ? "OK" : "MANQUANT");
  console.log("PROMPT =", prompt);

  if (!prompt) {
    return res.json({ error: "Aucun prompt reçu" });
  }

  // Liste de modèles à essayer dans l'ordre
  const models = [
    "runwayml/stable-diffusion-v1-5",
    "CompVis/stable-diffusion-v1-4",
    "stabilityai/stable-diffusion-2",
  ];

  for (const model of models) {
    try {
      const url = `https://api-inference.huggingface.co/models/${model}`;
      console.log("Essai modèle:", url);

      const response = await fetchJson(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.HF_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          inputs: prompt,
          options: { wait_for_model: true }
        })
      });

      console.log("STATUS HF:", response.status);
      console.log("CONTENT TYPE:", response.headers["content-type"]);

      if (response.status === 200 && response.headers["content-type"]?.includes("image")) {
        const base64 = response.buffer.toString("base64");
        return res.json({ image: `data:image/png;base64,${base64}` });
      } else {
        console.log("Modèle échoué:", response.text());
      }

    } catch (err) {
      console.log("Erreur modèle", model, ":", err.message);
    }
  }

  // Si aucun modèle n'a marché
  res.json({ error: "Tous les modèles sont indisponibles. Réessaie dans 1 minute." });
});

app.listen(PORT, () => {
  console.log("Serveur IA en ligne sur port " + PORT);
});
