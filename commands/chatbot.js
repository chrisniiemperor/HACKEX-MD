const fs = require('fs');
const path = require('path');

const USER_GROUP_DATA = path.join(__dirname, '../data/userGroupData.json');

const chatMemory = {
    messages: new Map(),
    userInfo: new Map()
};

// load data
function loadUserGroupData() {
    try {
        return JSON.parse(fs.readFileSync(USER_GROUP_DATA));
    } catch (e) {
        return { chatbot: {} };
    }
}

// save data
function saveUserGroupData(data) {
    fs.writeFileSync(USER_GROUP_DATA, JSON.stringify(data, null, 2));
}

// typing
async function showTyping(sock, chatId) {
    try {
        await sock.presenceSubscribe(chatId);
        await sock.sendPresenceUpdate('composing', chatId);
        await new Promise(r => setTimeout(r, 900));
    } catch {}
}

// chatbot ON/OFF
async function handleChatbotCommand(sock, chatId, message, match) {
    const data = loadUserGroupData();

    const senderId = message.key.participant || message.key.remoteJid;
    const isOwner = message.key.fromMe;

    if (!match) {
        return sock.sendMessage(chatId, { text: ".chatbot on/off" }, { quoted: message });
    }

    if (!isOwner) {
        return sock.sendMessage(chatId, { text: "❌ Only owner can use this" }, { quoted: message });
    }

    if (match === "on") {
        data.chatbot[chatId] = true;
        saveUserGroupData(data);
        return sock.sendMessage(chatId, { text: "✅ Gemini AI Chatbot Enabled" });
    }

    if (match === "off") {
        delete data.chatbot[chatId];
        saveUserGroupData(data);
        return sock.sendMessage(chatId, { text: "❌ Chatbot Disabled" });
    }
}

// 🤖 GEMINI AI REQUEST (FIXED + STABLE)
async function getAIResponse(message) {
    try {
        const API_KEY = process.env.GEMINI_API_KEY;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

        const payload = {
            contents: [
                {
                    parts: [
                        {
                            text: `You are a helpful WhatsApp assistant. Reply short and natural.\nUser: ${message}`
                        }
                    ]
                }
            ]
        };

        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        console.log("GEMINI RAW:", JSON.stringify(data));

        const reply =
            data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!reply) return "🤔 I couldn't understand that.";

        return reply;

    } catch (err) {
        console.log("GEMINI ERROR:", err.message);
        return "⚠️ AI temporarily unavailable";
    }
}

// 🤖 MAIN CHATBOT (REPLIES TO ALL MESSAGES WHEN ENABLED)
async function handleChatbotResponse(sock, chatId, message, userMessage, senderId) {
    const data = loadUserGroupData();

    if (!data.chatbot[chatId]) return;

    if (!userMessage) return;

    // memory init
    if (!chatMemory.messages.has(senderId)) {
        chatMemory.messages.set(senderId, []);
        chatMemory.userInfo.set(senderId, {});
    }

    const history = chatMemory.messages.get(senderId);

    history.push(userMessage);
    if (history.length > 10) history.shift();

    chatMemory.messages.set(senderId, history);

    await showTyping(sock, chatId);

    const reply = await getAIResponse(userMessage);

    await sock.sendMessage(chatId, {
        text: reply
    }, { quoted: message });
}

module.exports = {
    handleChatbotCommand,
    handleChatbotResponse
};