const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const USER_GROUP_DATA = path.join(__dirname, '../data/userGroupData.json');

// MEMORY
const chatMemory = {
    messages: new Map(),
    userInfo: new Map()
};

// =====================
// LOAD / SAVE DATA
// =====================
function loadUserGroupData() {
    try {
        return JSON.parse(fs.readFileSync(USER_GROUP_DATA));
    } catch (e) {
        return { chatbot: {} };
    }
}

function saveUserGroupData(data) {
    fs.writeFileSync(USER_GROUP_DATA, JSON.stringify(data, null, 2));
}

// =====================
// TYPING
// =====================
async function showTyping(sock, chatId) {
    try {
        await sock.presenceSubscribe(chatId);
        await sock.sendPresenceUpdate('composing', chatId);
        await new Promise(r => setTimeout(r, 1200));
    } catch {}
}

// =====================
// USER INFO EXTRACTION
// =====================
function extractUserInfo(msg) {
    const info = {};

    if (msg.toLowerCase().includes("my name is")) {
        info.name = msg.split("my name is")[1]?.trim()?.split(" ")[0];
    }

    if (msg.toLowerCase().includes("years old")) {
        info.age = msg.match(/\d+/)?.[0];
    }

    if (msg.toLowerCase().includes("i live in") || msg.toLowerCase().includes("i am from")) {
        info.location = msg.split(/i live in|i am from/i)[1]?.trim()?.split(/[.,!?]/)[0];
    }

    return info;
}

// =====================
// CHATBOT ON/OFF
// =====================
async function handleChatbotCommand(sock, chatId, message, match) {
    const data = loadUserGroupData();

    const senderId = message.key.participant || message.key.remoteJid;
    const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';

    const isOwner = message.key.fromMe || senderId.includes(botNumber.split('@')[0]);

    if (!match) {
        return sock.sendMessage(chatId, {
            text: `.chatbot on / off`
        }, { quoted: message });
    }

    if (!isOwner) {
        return sock.sendMessage(chatId, {
            text: "❌ Only owner can control bot"
        }, { quoted: message });
    }

    if (match === "on") {
        data.chatbot[chatId] = true;
        saveUserGroupData(data);
        return sock.sendMessage(chatId, { text: "✅ Chatbot enabled" });
    }

    if (match === "off") {
        delete data.chatbot[chatId];
        saveUserGroupData(data);
        return sock.sendMessage(chatId, { text: "❌ Chatbot disabled" });
    }
}

// =====================
// AI RESPONSE (FIXED + STABLE)
// =====================
async function getAIResponse(userMessage, userContext) {
    try {
        const prompt = `
You are a friendly WhatsApp chatbot.

Rules:
- Reply in 1–2 short lines
- Be natural and human-like
- Do NOT be robotic

User: ${userMessage}
User info: ${JSON.stringify(userContext.userInfo)}

Reply:
        `.trim();

        const res = await fetch(
            "https://api.simsimi.vn/v2/simtalk",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: `text=${encodeURIComponent(prompt)}&lc=en`
            }
        );

        const data = await res.json();

        return data?.message || "🤔 I don't know what to say";
    } catch (e) {
        return "⚠️ AI error, try again";
    }
}

// =====================
// MAIN AI HANDLER
// =====================
async function handleChatbotResponse(sock, chatId, message, userMessage, senderId) {
    const data = loadUserGroupData();

    if (!data.chatbot?.[chatId]) return;

    const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';

    const text = userMessage.toLowerCase();

    // FIXED TRIGGER SYSTEM
    const mentioned =
        message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.includes(botNumber);

    const keywords = ["bot", "ai", "knight"];

    const shouldTrigger =
        mentioned ||
        keywords.some(k => text.includes(k));

    if (!shouldTrigger) return;

    let cleanedMessage = userMessage.replace(/@\d+/g, "").trim();

    // INIT MEMORY SAFELY
    if (!chatMemory.messages.has(senderId)) {
        chatMemory.messages.set(senderId, []);
        chatMemory.userInfo.set(senderId, {});
    }

    const info = extractUserInfo(cleanedMessage);

    chatMemory.userInfo.set(senderId, {
        ...chatMemory.userInfo.get(senderId),
        ...info
    });

    const history = chatMemory.messages.get(senderId) || [];

    history.push(cleanedMessage);

    if (history.length > 10) history.shift();

    chatMemory.messages.set(senderId, history);

    await showTyping(sock, chatId);

    const reply = await getAIResponse(cleanedMessage, {
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