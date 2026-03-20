export default async function handler(req, res) {
  const GAS_URL = "https://script.google.com/macros/s/AKfycby-SaRu5rGg43IuOvHeRXM3wcE7gYZEJxVTqo7HFLVZYoiCzwcducKmN77iJcCTi35xhg/exec";

  try {
    const url = GAS_URL + "?path=" + req.query.path;

    const response = await fetch(url, {
      method: req.method,
      headers: {
        "Content-Type": "application/json"
      },
      body: req.method === "POST" ? JSON.stringify(req.body) : undefined
    });

    const text = await response.text();

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).send(text);

  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
}