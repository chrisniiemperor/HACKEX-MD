const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const USER_GROUP_DATA = path.join(__dirname, '../data/userGroupData.json');

// 🔑 OpenAI setup
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// memory system
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
        await new Promise(r => setTimeout(r, 1000));
    } catch (e) {}
}

// simple info extractor
function extractUserInfo(msg) {
    const info = {};

    if (msg.toLowerCase().includes("my name is")) {
        info.name = msg.split("my name is")[1]?.trim()?.split(" ")[0];
    }

    if (msg.match(/\d+\s*years?\s*old/)) {
        info.age = msg.match(/\d+/)?.[0];
    }

    if (msg.toLowerCase().includes("i live in") || msg.toLowerCase().includes("i am from")) {
        info.location = msg.split(/i live in|i am from/i)[1]?.trim()?.split(/[.,!?]/)[0];
    }

    return info;
}

// enable / disable chatbot
async function handleChatbotCommand(sock, chatId, message, match) {
    const data = loadUserGroupData();

    const senderId = message.key.participant || message.key.remoteJid;
    const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';

    const isOwner = message.key.fromMe || senderId === botNumber;

    if (!match) {
        return sock.sendMessage(chatId, {
            text: ".chatbot on/off"
        }, { quoted: message });
    }

    if (!isOwner) {
        return sock.sendMessage(chatId, {
            text: "❌ Only owner can use this command"
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

// 🤖 OPENAI RESPONSE (FIXED + COMPATIBLE MODEL)
async function getAIResponse(userMessage, userContext) {
    try {
        if (!process.env.OPENAI_API_KEY) {
            return "❌ API key not set";
        }

        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo", // 🔥 MOST COMPATIBLE MODEL
            messages: [
                {
                    role: "system",
                    content: `
You are a friendly WhatsApp chatbot.
Reply naturally in 1–2 short sentences.
Be helpful and conversational.
                    `
                },
                {
                    role: "system",
                    content: `User info: ${JSON.stringify(userContext.userInfo)}`
                },
                {
                    role: "user",
                    content: userMessage
                }
            ],
            temperature: 0.7,
            max_tokens: 150
        });

        return response.choices?.[0]?.message?.content?.trim() ||
            "I didn't understand that.";

    } catch (err) {
        console.log("OPENAI ERROR:", err.message);
        return "⚠️ AI temporarily unavailable";
    }
}

// 🤖 MAIN CHATBOT (REPLIES TO EVERYTHING IF ENABLED)
async function handleChatbotResponse(sock, chatId, message, userMessage, senderId) {
    const data = loadUserGroupData();

    if (!data.chatbot[chatId]) return;

    if (!userMessage || userMessage.trim().length === 0) return;

    // init memory
    if (!chatMemory.messages.has(senderId)) {
        chatMemory.messages.set(senderId, []);
        chatMemory.userInfo.set(senderId, {});
    }

    // extract info
    const info = extractUserInfo(userMessage);

    chatMemory.userInfo.set(senderId, {
        ...chatMemory.userInfo.get(senderId),
        ...info
    });

    const history = chatMemory.messages.get(senderId);

    history.push(userMessage);
    if (history.length > 8) history.shift();

    chatMemory.messages.set(senderId, history);

    await showTyping(sock, chatId);

    const reply = await getAIResponse(userMessage, {
        messages: history,
        userInfo: chatMemory.userInfo.get(senderId)
    });

    await sock.sendMessage(chatId, {
        text: reply
    }, { quoted: message });
}

module.exports = {
    handleChatbotCommand,
    handleChatbotResponse
};