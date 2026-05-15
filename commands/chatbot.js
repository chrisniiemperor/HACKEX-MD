const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const USER_GROUP_DATA = path.join(__dirname, '../data/userGroupData.json');

// =========================
// MEMORY STORAGE
// =========================
const chatMemory = {
    messages: new Map(),
    userInfo: new Map(),
    cooldown: new Map()
};

// =========================
// GROUP DATA
// =========================

function loadUserGroupData() {
    try {
        if (!fs.existsSync(USER_GROUP_DATA)) {
            return { chatbot: {} };
        }
        return JSON.parse(fs.readFileSync(USER_GROUP_DATA, 'utf8'));
    } catch (err) {
        console.error("LOAD ERROR:", err.message);
        return { chatbot: {} };
    }
}

function saveUserGroupData(data) {
    try {
        fs.writeFileSync(USER_GROUP_DATA, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("SAVE ERROR:", err.message);
    }
}

// =========================
// UTILITIES
// =========================

function normalizeJid(jid = "") {
    return jid.split("@")[0].split(":")[0];
}

function getRandomDelay() {
    return Math.floor(Math.random() * 2500) + 1000;
}

async function showTyping(sock, chatId) {
    try {
        await sock.presenceSubscribe(chatId);
        await sock.sendPresenceUpdate("composing", chatId);

        await new Promise(r =>
            setTimeout(r, getRandomDelay())
        );

    } catch (err) {
        console.error("Typing error:", err.message);
    }
}

function sanitize(text = "") {
    return text.replace(/[{}[\]$`]/g, "").trim();
}

// =========================
// EXTRACT USER INFO
// =========================

function extractUserInfo(msg) {

    const info = {};
    const lower = msg.toLowerCase();

    if (lower.includes("my name is")) {
        info.name = msg.split(/my name is/i)[1]?.split(" ")[0];
    }

    const age = msg.match(/(\d+)\s*years?\s*old/i);
    if (age) info.age = age[1];

    if (lower.includes("i live in") || lower.includes("i am from")) {
        info.location =
            msg.split(/i live in|i am from/i)[1]?.split(/[.!?,]/)[0];
    }

    return info;
}

// =========================
// CHATBOT COMMAND
// =========================

async function handleChatbotCommand(sock, chatId, message, match) {

    const data = loadUserGroupData();

    const sender =
        message.key.participant ||
        message.key.remoteJid;

    const botNumber = normalizeJid(sock.user.id);
    const cleanSender = normalizeJid(sender);

    const isOwner = cleanSender === botNumber;

    if (!match) {
        await showTyping(sock, chatId);

        return sock.sendMessage(chatId, {
            text: `
*CHATBOT CONTROL*

.chatbot on → enable bot
.chatbot off → disable bot
            `.trim(),
            quoted: message
        });
    }

    // OWNER ONLY CONTROL (simple safe version)
    if (!isOwner) {
        await showTyping(sock, chatId);

        return sock.sendMessage(chatId, {
            text: "❌ Only bot owner can use this.",
            quoted: message
        });
    }

    if (match === "on") {
        data.chatbot[chatId] = true;
        saveUserGroupData(data);

        return sock.sendMessage(chatId, {
            text: "✅ Chatbot enabled",
            quoted: message
        });
    }

    if (match === "off") {
        delete data.chatbot[chatId];
        saveUserGroupData(data);

        return sock.sendMessage(chatId, {
            text: "❌ Chatbot disabled",
            quoted: message
        });
    }
}

// =========================
// CHAT RESPONSE HANDLER
// =========================

async function handleChatbotResponse(
    sock,
    chatId,
    message,
    userMessage,
    senderId
) {

    try {

        const data = loadUserGroupData();

        if (!data.chatbot[chatId]) return;

        if (!userMessage) return;

        const botId = normalizeJid(sock.user.id);

        const contextInfo =
            message.message?.extendedTextMessage?.contextInfo;

        const mentionedJid =
            contextInfo?.mentionedJid || [];

        const quoted = contextInfo?.participant;

        const isMentioned = mentionedJid.some(
            jid => normalizeJid(jid) === botId
        );

        const isReply =
            quoted &&
            normalizeJid(quoted) === botId;

        // 🔥 Human-like random reply in groups
        const randomReply = Math.random() < 0.18;

        const shouldReply =
            isMentioned ||
            isReply ||
            randomReply;

        if (!shouldReply) return;

        // Ignore bot itself
        if (message.key.fromMe) return;

        const cleanMessage = sanitize(userMessage);

        // =========================
        // MEMORY INIT
        // =========================

        if (!chatMemory.messages.has(senderId)) {
            chatMemory.messages.set(senderId, []);
            chatMemory.userInfo.set(senderId, {});
        }

        // update user info
        const info = extractUserInfo(cleanMessage);

        chatMemory.userInfo.set(senderId, {
            ...chatMemory.userInfo.get(senderId),
            ...info
        });

        // store message history
        const history = chatMemory.messages.get(senderId);

        history.push(cleanMessage);

        if (history.length > 5) history.shift();

        chatMemory.messages.set(senderId, history);

        // typing delay
        await showTyping(sock, chatId);

        // get AI reply
        const reply = await getAIResponse(cleanMessage, {
            messages: history,
            userInfo: chatMemory.userInfo.get(senderId)
        });

        if (!reply) return;

        await sock.sendMessage(chatId, {
            text: reply
        }, {
            quoted: message
        });

    } catch (err) {
        console.error("CHAT ERROR:", err.message);
    }
}

// =========================
// AI (HUGGINGFACE API)
// =========================

const HF_API_KEY = process.env.HF_API_KEY;

async function getAIResponse(userMessage, userContext = {}) {

    try {

        const history =
            userContext.messages?.join("\n") || "";

        const prompt = `
You are a casual WhatsApp group member.

Rules:
- short replies
- natural human tone
- use emojis
- no AI talk
- act like a real person

Chat history:
${history}

User:
${userMessage}

Reply:
`.trim();

        const response = await fetch(
            "https://api-inference.huggingface.co/models/Qwen/Qwen2.5-3B-Instruct",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(HF_API_KEY && {
                        Authorization: `Bearer ${HF_API_KEY}`
                    })
                },
                body: JSON.stringify({
                    inputs: prompt,
                    parameters: {
                        max_new_tokens: 80,
                        temperature: 0.9
                    }
                })
            }
        );

        if (!response.ok) {
            return "😅 network issue";
        }

        const data = await response.json();

        let text =
            data?.generated_text ||
            data?.[0]?.generated_text ||
            "";

        if (!text) return "😂";

        text = text
            .replace(prompt, "")
            .replace(/User:|Reply:/gi, "")
            .trim();

        return text || "😅";

    } catch (err) {
        console.error("AI ERROR:", err.message);
        return "server dey slow 😭";
    }
}

// =========================
// AUTO CLEAN MEMORY
// =========================

setInterval(() => {
    chatMemory.messages.clear();
    chatMemory.userInfo.clear();
    chatMemory.cooldown.clear();
}, 1000 * 60 * 60);

// =========================
// EXPORTS
// =========================

module.exports = {
    handleChatbotCommand,
    handleChatbotResponse
};