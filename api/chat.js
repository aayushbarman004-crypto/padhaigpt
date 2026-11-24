// Vercel serverless function: /api/chat
// Environment variables (Vercel > Settings > Environment Variables):
//   GEMINI_API_KEY  (required)
//   GEMINI_MODEL    (optional, default below)

const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const hits = new Map(); // simple per-IP limit (best effort)
const LIMIT = 40, WINDOW = 60 * 60 * 1000;

function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < WINDOW);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > LIMIT;
}

function systemPrompt(level, quiz, pyq) {
  let s =
    "Tum PadhaiGPT ho, ek friendly education AI assistant. Students aur learners ki padhai me madad karo: " +
    "concepts ko simple language me, step-by-step aur examples ke saath samjhao. Math, science, coding, history, " +
    "languages, exam preparation aur career guidance sab me help karo. User padhai ke alawa kuch bhi pooche to bhi achha jawab do. " +
    "User jis language me likhe (Hindi/Hinglish/English), usi me jawab do. Jawab clear, accurate aur encouraging rakho. " +
    "Student ka level: " + level + ". Isi level ke hisaab se samjhao.";
  if (quiz)
    s += " QUIZ MODE ON: student ko topic par ek hi sawal poochho, uske jawab ka intezaar karo, phir jawab check karke feedback do aur agla sawal poochho. Jab tak student na maange, seedha answer mat batao.";
  if (pyq)
    s += " EXAM PRACTICE MODE ON: student ke topic aur exam ke liye pichhle saalon me puchhe gaye (previous year) style ke sawal aur aane wale exam me sabse zyada aane ki sambhavna wale important sawal do. Har sawal ke saath type (MCQ/short/long), marks aur importance (High/Medium) likho, phir uska answer do. Sirf wahi sawal pichhle saal puchha gaya batao jo tumhe pakka pata ho; baaki ko pattern ke hisaab se expected likho. Koi guarantee mat do. Aakhir me student ko official past papers se verify karne ko kaho.";
  return s;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "Server me GEMINI_API_KEY set nahi hai." });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return res.status(429).json({ error: "Bahut zyada messages. Thodi der baad try karo." });

  const body = req.body || {};
  const msgs = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  const contents = msgs
    .filter(m => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
    .map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content.slice(0, 2000) }] }));
  if (!contents.length || contents[contents.length - 1].role !== "user")
    return res.status(400).json({ error: "Message missing." });

  const level = String(body.level || "Koi bhi level").slice(0, 40);
  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt(level, !!body.quiz, !!body.pyq) }] },
          contents,
        }),
      }
    );
    const d = await r.json();
    if (!r.ok) {
      const code = r.status === 429 ? 429 : 502;
      return res.status(code).json({
        error: r.status === 429 ? "Free limit khatam. Thodi der baad try karo." : "AI se jawab nahi mila.",
      });
    }
    const text = ((d.candidates || [])[0]?.content?.parts || []).map(p => p.text || "").join("").trim();
    return res.status(200).json({ text: text || "Jawab nahi mila, dobara try karo." });
  } catch (e) {
    return res.status(500).json({ error: "Server error. Dobara try karo." });
  }
};
