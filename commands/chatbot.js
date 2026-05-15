
const fs = require("fs");
const fetch = require("node-fetch");
const { OpenAI } = require("openai");

// =========================
// GPT CLIENT
// =========================
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// =========================
// OWNER CONFIG (IMPORTANT FIX)
// =========================
const OWNERS = [
    "233XXXXXXXXX@s.whatsapp.net" // <-- CHANGE THIS TO YOUR NUMBER
];

// =========================
// TEMP MEMORY ONLY
// =========================
const chatMemory = {
    messages: new Map()
};

// =========================
// GROUP DATA
// =========================
const GROUP_FILE = "./userGroupData.json";

function loadGroupData() {
    try {
        if (!fs.existsSync(GROUP_FILE)) {
            return { chatbot: {} };
        }
        return JSON.parse(fs.readFileSync(GROUP_FILE, "utf8"));
    } catch {
        return { chatbot: {} };
    }
}

function saveGroupData(data) {
    fs.writeFileSync(GROUP_FILE, JSON.stringify(data, null, 2));
}

// =========================
// BOT PERSONALITY
// =========================
const botConfig = {
    personality: "funny" // friendly | funny | savage
};

// =========================
// UTILITIES
// =========================
function normalize(jid = "") {
    return jid.split("@")[0].split(":")[0];
}

function getSender(msg) {
    return (
        msg.key.participant ||
        msg.participant ||
        msg.key.remoteJid
    );
}

function sanitize(text = "") {
    return text.replace(/[{}[\]$`]/g, "").trim();
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function typingDelay(text) {
    const base = text.length * 40;
    return Math.min(base + Math.random() * 2000, 6000);
}

function shouldReply() {
    return Math.random() < 0.22;
}

// =========================
// PROMPT BUILDER
// =========================
function buildPrompt(msg, history) {

    let style = "";

    if (botConfig.personality === "friendly") {
        style = "Be friendly and supportive WhatsApp friend.";
    }

    if (botConfig.personality === "funny") {
        style = "Be funny, sarcastic WhatsApp friend.";
    }

    if (botConfig.personality === "savage") {
        style = "Be slightly savage but NOT abusive or hateful.";
    }

    return `
You are a real human in a WhatsApp group.

${style}

RULES:
- 1–2 lines max
- use emojis naturally
- act human
- roast only if user is rude
- no AI mention

Chat history:
${history}

User:
${msg}

Reply:
`.trim();
}

// =========================
// AI (HF + GPT FALLBACK)
// =========================
async function getAIResponse(msg, history) {

    const prompt = buildPrompt(msg, history);

    // =========================
    // HF FIRST
    // =========================
    try {

        const hfRes = await fetch(
            "https://api-inference.huggingface.co/models/Qwen/Qwen2.5-3B-Instruct",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(process.env.HF_API_KEY && {
                        Authorization: `Bearer ${process.env.HF_API_KEY}`
                    })
                },
                body: JSON.stringify({
                    inputs: prompt,
                    parameters: {
                        max_new_tokens: 70,
                        temperature: 0.9
                    }
                })
            }
        );

        if (hfRes.ok) {
            const data = await hfRes.json();

            let reply =
                data?.generated_text ||
                data?.[0]?.generated_text;

            if (reply) {
                return reply.replace(prompt, "").trim();
            }
        }

    } catch (err) {
        console.log("HF failed → switching to GPT");
    }

    // =========================
    // GPT FALLBACK
    // =========================
    try {

        const gpt = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content:
`You are a WhatsApp group member.
Be short, funny, human-like.
Light roast if user is rude.`
                },
                {
                    role: "user",
                    content: `${history}\n\nUser: ${msg}`
                }
            ],
            temperature: 0.9,
            max_tokens: 80
        });

        return gpt.choices?.[0]?.message?.content?.trim() || null;

    } catch (err) {
        console.error("GPT ERROR:", err.message);
        return null;
    }
}

// =========================
// CHATBOT COMMAND
// =========================
async function handleChatbotCommand(sock, chatId, msg, match) {

    const data = loadGroupData();

    if (!match) {
        return sock.sendMessage(chatId, {
            text: `.chatbot on / off`,
            quoted: msg
        });
    }

    const sender = getSender(msg);
    const senderNumber = normalize(sender);

    const isOwner = OWNERS.includes(sender);

    if (!isOwner) {
        return sock.sendMessage(chatId, {
            text: "❌ Only owner can control bot",
            quoted: msg
        });
    }

    if (match === "on") {
        data.chatbot[chatId] = true;
        saveGroupData(data);

        return sock.sendMessage(chatId, {
            text: "🤖 Chatbot ENABLED",
            quoted: msg
        });
    }

    if (match === "off") {
        delete data.chatbot[chatId];
        saveGroupData(data);

        return sock.sendMessage(chatId, {
            text: "❌ Chatbot DISABLED",
            quoted: msg
        });
    }
}

// =========================
// MAIN HANDLER
// =========================
async function handleChatbotResponse(
    sock,
    chatId,
    message,
    userMessage,
    senderId
) {

    const data = loadGroupData();

    if (!data.chatbot[chatId]) return;
    if (!userMessage) return;
    if (message.key.fromMe) return;

    const botId = normalize(sock.user.id);

    const context =
        message.message?.extendedTextMessage?.contextInfo;

    const mentioned =
        context?.mentionedJid?.some(
            j => normalize(j) === botId
        );

    const replyToBot =
        context?.participant &&
        normalize(context.participant) === botId;

    if (!mentioned && !replyToBot && !shouldReply()) return;

    const clean = sanitize(userMessage);

    // TEMP MEMORY
    if (!chatMemory.messages.has(senderId)) {
        chatMemory.messages.set(senderId, []);
    }

    const historyArr = chatMemory.messages.get(senderId);

    historyArr.push(clean);
    if (historyArr.length > 5) historyArr.shift();

    const history = historyArr.join("\n");

    await delay(typingDelay(clean));

    const reply = await getAIResponse(clean, history);

    if (!reply) return;

    await delay(typingDelay(reply));

    await sock.sendMessage(chatId, {
        text: reply
    }, {
        quoted: message
    });
}

// =========================
// EXPORTS
// =========================
module.exports = {
    handleChatbotCommand,
    handleChatbotResponse
};