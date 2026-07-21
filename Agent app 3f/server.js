// ═══════════════════════════════════════
// ARIA — server.js
// Clean Backend Server (No Claude API)
// Ready for Future APIs
// ═══════════════════════════════════════

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ───────────────────────────────────────
// MIDDLEWARE
// ───────────────────────────────────────
app.use(cors());

app.use(express.json({
  limit: "10mb"
}));

app.use(express.urlencoded({
  extended: true
}));

// ───────────────────────────────────────
// TEST ROUTE
// ───────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    success: true,
    app: "ARIA Backend Server",
    status: "Running",
    port: PORT
  });
});

// ───────────────────────────────────────
// CHAT ROUTE
// TEMPORARY AI RESPONSE
// Replace later with OpenAI / Gemini / Claude
// ───────────────────────────────────────
app.post("/chat", async (req, res) => {

  try {

    const { message, mode } = req.body;

    // Validation
    if (!message) {
      return res.status(400).json({
        success: false,
        error: "Message is required"
      });
    }

    // Temporary responses
    let reply = "";

    switch (mode) {

      case "think":
        reply =
          `🧠 THINK MODE\n\n` +
          `You said: "${message}"\n\n` +
          `This is a temporary backend response.\n` +
          `Your frontend and backend are connected successfully.`;

        break;

      case "research":
        reply =
          `🔍 RESEARCH MODE\n\n` +
          `Researching: "${message}"\n\n` +
          `Backend is working correctly.`;

        break;

      case "create":
        reply =
          `🎨 CREATE MODE\n\n` +
          `Creating content for: "${message}"\n\n` +
          `Your ARIA app is operational.`;

        break;

      case "execute":
        reply =
          `🚀 EXECUTE MODE\n\n` +
          `Execution plan for: "${message}"\n\n` +
          `Backend connection established.`;

        break;

      default:
        reply =
          `🤖 ARIA RESPONSE\n\n` +
          `You said: "${message}"\n\n` +
          `Server is running perfectly.`;
    }

    // Send response
    res.status(200).json({
      success: true,
      reply: reply
    });

  } catch (error) {

    console.error("SERVER ERROR:", error);

    res.status(500).json({
      success: false,
      error: "Internal Server Error"
    });
  }
});

// ───────────────────────────────────────
// 404 ROUTE
// ───────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route not found"
  });
});

// ───────────────────────────────────────
// START SERVER
// ───────────────────────────────────────
app.listen(PORT, () => {

  console.log(`
╔══════════════════════════════════════╗
║                                      ║
║        ARIA SERVER RUNNING           ║
║                                      ║
║   http://localhost:${PORT}            ║
║                                      ║
╚══════════════════════════════════════╝
  `);

});