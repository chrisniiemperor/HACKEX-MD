require("dotenv").config();
const OpenAI = require("openai");

// =====================
// OPENROUTER SETUP
// =====================
const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

// =====================
// MEMORY + STATE
// =====================
const memory = new Map(); // user chat memory
const enabledChats = new Set(); // chatbot ON/OFF per group

// =====================
// AI FUNCTION
// =====================
async function askAI(userId, message) {
  try {
    if (!memory.has(userId)) {
      memory.set(userId, []);
    }

    const history = memory.get(userId);

    history.push({ role: "user", content: message });

    if (history.length > 10) history.shift();

    const res = await client.chat.completions.create({
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful WhatsApp assistant. Reply short, natural, and friendly."
        },
        ...history
      ]
    });

    const reply = res.choices?.[0]?.message?.content;

    if (reply) {
      history.push({ role: "assistant", content: reply });
    }

    return reply || "🤔 I couldn't understand that.";
  } catch (err) {
    console.log("OpenRouter Error:", err.message);
    return "⚠️ AI temporarily unavailable";
  }
}

// =====================
// TOGGLE CHATBOT
// =====================
async function handleChatbotCommand(sock, chatId, message, args) {
  const sender = message.key.participant || message.key.remoteJid;
  const isOwner = message.key.fromMe;

  if (!args) {
    return sock.sendMessage(chatId, {
      text: ".chatbot on/off"
    }, { quoted: message });
  }

  if (!isOwner) {
    return sock.sendMessage(chatId, {
      text: "❌ Only owner can control chatbot"
    }, { quoted: message });
  }

  if (args === "on") {
    enabledChats.add(chatId);
    return sock.sendMessage(chatId, {
      text: "✅ OpenRouter AI Chatbot ENABLED"
    }, { quoted: message });
  }

  if (args === "off") {
    enabledChats.delete(chatId);
    return sock.sendMessage(chatId, {
      text: "❌ OpenRouter AI Chatbot DISABLED"
    }, { quoted: message });
  }
}

// =====================
// MAIN AUTO RESPONSE
// =====================
async function handleChatbotResponse(sock, chatId, message, text, senderId) {
  try {
    if (!enabledChats.has(chatId)) return;
    if (!text) return;

    // typing indicator
    await sock.sendPresenceUpdate("composing", chatId);

    const reply = await askAI(senderId, text);

    await sock.sendMessage(chatId, {
      text: reply
    }, { quoted: message });

  } catch (err) {
    console.log("Chatbot Error:", err.message);
  }
}

// =====================
// EXPORTS
// =====================
module.exports = {
  handleChatbotCommand,
  handleChatbotResponse
};