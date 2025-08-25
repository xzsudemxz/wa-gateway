import express from "express";

const app = express();
app.use(express.json());

// endpoint de saúde
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("WA Gateway ON:", PORT));
