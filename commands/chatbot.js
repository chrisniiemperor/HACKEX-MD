const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const USER_GROUP_DATA = path.join(__dirname, '../data/userGroupData.json');

// memory
const chatMemory = {
    messages: new Map(),
    userInfo: new Map()
};

// load data
function loadUserGroupData() {
    try {
        return JSON.parse(fs.readFileSync(USER_GROUP_DATA));
    } catch (e) {
        return { groups: [], chatbot: {} };
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
        await new Promise(r => setTimeout(r, 1500));
    } catch {}
}

// extract info
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

// chatbot ON/OFF
async function handleChatbotCommand(sock, chatId, message, match) {
    const data = loadUserGroupData();

    const senderId = message.key.participant || message.key.remoteJid;
    const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';

    const isOwner = message.key.fromMe || senderId === botNumber;

    if (!match) {
        return sock.sendMessage(chatId, {
            text: `.chatbot on/off`
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

// AI RESPONSE (FIXED + WORKING)
async function getAIResponse(userMessage, userContext) {
    try {
        const prompt = `
You are a friendly WhatsApp chatbot.

Keep replies short (1–2 lines).
Be natural, casual, human-like.

User: ${userMessage}
Context: ${JSON.stringify(userContext.userInfo)}

Reply:
        `.trim();

        const res = await fetch(
            "https://api.simsimi.vn/v2/simtalk",
            {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: `text=${encodeURIComponent(userMessage)}&lc=en`
            }
        );

        const data = await res.json();
        return data.message || "Hmm 🤔";
    } catch (e) {
        return null;
    }
}

// MAIN CHATBOT RESPONSE
async function handleChatbotResponse(sock, chatId, message, userMessage, senderId) {
    const data = loadUserGroupData();
    if (!data.chatbot[chatId]) return;

    const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';

    // FIXED TRIGGER SYSTEM
    const shouldTrigger =
        message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.includes(botNumber) ||
        userMessage.toLowerCase().includes("bot") ||
        userMessage.toLowerCase().includes("ai");

    if (!shouldTrigger) return;

    let cleanedMessage = userMessage.replace(/@?\d+/g, "").trim();

    if (!chatMemory.messages.has(senderId)) {
        chatMemory.messages.set(senderId, []);
        chatMemory.userInfo.set(senderId, {});
    }

    const info = extractUserInfo(cleanedMessage);

    chatMemory.userInfo.set(senderId, {
        ...chatMemory.userInfo.get(senderId),
        ...info
    });

    const history = chatMemory.messages.get(senderId);
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