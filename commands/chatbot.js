const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

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

// typing effect
async function showTyping(sock, chatId) {
    try {
        await sock.presenceSubscribe(chatId);
        await sock.sendPresenceUpdate('composing', chatId);
        await new Promise(r => setTimeout(r, 1200));
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
        return sock.sendMessage(chatId, { text: "✅ Chatbot enabled (FREE AI)" });
    }

    if (match === "off") {
        delete data.chatbot[chatId];
        saveUserGroupData(data);
        return sock.sendMessage(chatId, { text: "❌ Chatbot disabled" });
    }
}

// 🤖 FREE AI RESPONSE (HUGGINGFACE)
async function getAIResponse(message) {
    try {
        const res = await fetch(
            "https://api-inference.huggingface.co/models/microsoft/DialoGPT-medium",
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.HF_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    inputs: message
                })
            }
        );

        const data = await res.json();

        // fallback handling
        if (Array.isArray(data) && data[0]?.generated_text) {
            return data[0].generated_text;
        }

        if (data?.generated_text) {
            return data.generated_text;
        }

        return "🤔 I don't understand that.";

    } catch (err) {
        console.log("HF ERROR:", err.message);
        return "⚠️ AI temporarily unavailable";
    }
}

// 🤖 MAIN CHATBOT (REPLIES TO ALL MESSAGES IF ENABLED)
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
    if (history.length > 8) history.shift();

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