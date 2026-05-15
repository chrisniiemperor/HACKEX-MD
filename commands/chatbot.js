const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

require("dotenv").config();

const USER_GROUP_DATA = path.join(__dirname, "../data/userGroupData.json");

// 🧠 MEMORY
const chatMemory = {
    messages: new Map(),
    userInfo: new Map()
};

// 🔑 OPENAI INIT
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// LOAD DATA
function loadUserGroupData() {
    try {
        return JSON.parse(fs.readFileSync(USER_GROUP_DATA));
    } catch (e) {
        return { chatbot: {} };
    }
}

// SAVE DATA
function saveUserGroupData(data) {
    fs.writeFileSync(USER_GROUP_DATA, JSON.stringify(data, null, 2));
}

// TYPING
async function showTyping(sock, chatId) {
    try {
        await sock.presenceSubscribe(chatId);
        await sock.sendPresenceUpdate("composing", chatId);
        await new Promise(r => setTimeout(r, 1200));
    } catch {}
}

// CHATBOT ON/OFF
async function handleChatbotCommand(sock, chatId, message, match) {
    const data = loadUserGroupData();

    const senderId = message.key.participant || message.key.remoteJid;

    if (!match) {
        return sock.sendMessage(chatId, {
            text: ".chatbot on/off"
        }, { quoted: message });
    }

    const isOwner = message.key.fromMe;

    if (!isOwner) {
        return sock.sendMessage(chatId, {
            text: "❌ Only owner can control chatbot"
        }, { quoted: message });
    }

    if (match === "on") {
        data.chatbot[chatId] = true;
        saveUserGroupData(data);

        return sock.sendMessage(chatId, {
            text: "✅ ChatGPT Bot enabled"
        });
    }

    if (match === "off") {
        delete data.chatbot[chatId];
        saveUserGroupData(data);

        return sock.sendMessage(chatId, {
            text: "❌ ChatGPT Bot disabled"
        });
    }
}

// 🧠 OPENAI FUNCTION (CHATGPT)
async function getAIResponse(userMessage, userContext) {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `
You are a WhatsApp assistant.
- Be short (1–3 lines max)
- Be friendly and natural
- Avoid long explanations unless asked
                    `
                },
                {
                    role: "user",
                    content: `
Message: ${userMessage}
User info: ${JSON.stringify(userContext.userInfo || {})}
                    `
                }
            ],
            temperature: 0.8
        });

        return response.choices?.[0]?.message?.content?.trim()
            || "I'm not sure how to respond.";
    } catch (error) {
        console.log("OpenAI Error:", error.message);
        return "⚠️ AI temporarily unavailable";
    }
}

// MAIN CHATBOT (REPLIES TO EVERYTHING)
async function handleChatbotResponse(sock, chatId, message, userMessage, senderId) {
    const data = loadUserGroupData();

    // check enabled
    if (!data.chatbot[chatId]) return;

    if (!userMessage || !userMessage.trim()) return;

    const text = userMessage.trim();

    // INIT MEMORY
    if (!chatMemory.messages.has(senderId)) {
        chatMemory.messages.set(senderId, []);
        chatMemory.userInfo.set(senderId, {});
    }

    const history = chatMemory.messages.get(senderId);

    // store last messages
    history.push(text);
    if (history.length > 10) history.shift();

    chatMemory.messages.set(senderId, history);

    // typing effect
    await showTyping(sock, chatId);

    // AI CALL
    const reply = await getAIResponse(text, {
        messages: history,
        userInfo: chatMemory.userInfo.get(senderId)
    });

    if (!reply) return;

    await sock.sendMessage(chatId, {
        text: reply
    }, { quoted: message });
}

module.exports = {
    handleChatbotCommand,
    handleChatbotResponse
};