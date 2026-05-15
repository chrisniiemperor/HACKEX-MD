const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const USER_GROUP_DATA = path.join(__dirname, '../data/userGroupData.json');

// MEMORY STORAGE
const chatMemory = {
    messages: new Map(),
    userInfo: new Map()
};

// LOAD DATA
function loadUserGroupData() {
    try {
        return JSON.parse(fs.readFileSync(USER_GROUP_DATA));
    } catch (e) {
        return { groups: [], chatbot: {} };
    }
}

// SAVE DATA
function saveUserGroupData(data) {
    fs.writeFileSync(USER_GROUP_DATA, JSON.stringify(data, null, 2));
}

// TYPING INDICATOR
async function showTyping(sock, chatId) {
    try {
        await sock.presenceSubscribe(chatId);
        await sock.sendPresenceUpdate('composing', chatId);
        await new Promise(r => setTimeout(r, 1200));
    } catch {}
}

// EXTRACT SIMPLE USER INFO
function extractUserInfo(msg) {
    const info = {};

    if (msg.toLowerCase().includes("my name is")) {
        info.name = msg.split("my name is")[1]?.trim()?.split(" ")[0];
    }

    if (msg.toLowerCase().includes("years old")) {
        info.age = msg.match(/\d+/)?.[0];
    }

    if (
        msg.toLowerCase().includes("i live in") ||
        msg.toLowerCase().includes("i am from")
    ) {
        info.location = msg.split(/i live in|i am from/i)[1]?.trim()?.split(/[.,!?]/)[0];
    }

    return info;
}

// ENABLE / DISABLE CHATBOT
async function handleChatbotCommand(sock, chatId, message, match) {
    const data = loadUserGroupData();

    const senderId = message.key.participant || message.key.remoteJid;

    const botNumber =
        sock.user?.id?.split(':')[0] + '@s.whatsapp.net';

    const isOwner =
        message.key.fromMe || senderId === botNumber;

    if (!match) {
        return sock.sendMessage(chatId, {
            text: `.chatbot on/off`
        }, { quoted: message });
    }

    if (!isOwner) {
        return sock.sendMessage(chatId, {
            text: "❌ Only owner can control chatbot"
        }, { quoted: message });
    }

    if (match === "on") {
        data.chatbot[chatId] = true;
        saveUserGroupData(data);

        return sock.sendMessage(chatId, {
            text: "✅ Chatbot enabled (replies to all messages)"
        });
    }

    if (match === "off") {
        delete data.chatbot[chatId];
        saveUserGroupData(data);

        return sock.sendMessage(chatId, {
            text: "❌ Chatbot disabled"
        });
    }
}

// AI RESPONSE (SIMSIMI)
async function getAIResponse(userMessage) {
    try {
        const res = await fetch("https://api.simsimi.vn/v2/simtalk", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: `text=${encodeURIComponent(userMessage)}&lc=en`
        });

        const data = await res.json();

        return data?.message || data?.success || "🤔 I don't understand that.";
    } catch (e) {
        console.log("AI ERROR:", e.message);
        return "⚠️ AI error occurred";
    }
}

// MAIN CHATBOT (REPLIES TO EVERYTHING)
async function handleChatbotResponse(sock, chatId, message, userMessage, senderId) {
    const data = loadUserGroupData();

    // must be enabled for this chat
    if (!data.chatbot[chatId]) return;

    if (!userMessage || !userMessage.trim()) return;

    const cleanedMessage = userMessage.trim();

    // INIT MEMORY
    if (!chatMemory.messages.has(senderId)) {
        chatMemory.messages.set(senderId, []);
        chatMemory.userInfo.set(senderId, {});
    }

    const info = extractUserInfo(cleanedMessage);

    chatMemory.userInfo.set(senderId, {
        ...chatMemory.userInfo.get(senderId),
        ...info
    });

    // STORE HISTORY
    const history = chatMemory.messages.get(senderId);
    history.push(cleanedMessage);

    if (history.length > 10) history.shift();

    chatMemory.messages.set(senderId, history);

    // SHOW TYPING
    await showTyping(sock, chatId);

    // GET AI RESPONSE
    const reply = await getAIResponse(cleanedMessage);

    if (!reply) return;

    await sock.sendMessage(chatId, {
        text: reply
    }, { quoted: message });
}

module.exports = {
    handleChatbotCommand,
    handleChatbotResponse
};