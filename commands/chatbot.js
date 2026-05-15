const fs = require("fs");
const fetch = require("node-fetch");

// =========================
// GROUP DATA
// =========================
const GROUP_FILE = "./userGroupData.json";

function loadData() {
    try {
        return JSON.parse(fs.readFileSync(GROUP_FILE));
    } catch {
        return { chatbot: {} };
    }
}

function saveData(data) {
    fs.writeFileSync(GROUP_FILE, JSON.stringify(data, null, 2));
}

// =========================
// CLEAN JID
// =========================
function getNumber(jid = "") {
    return jid.split("@")[0].split(":")[0];
}

// =========================
// AI ENGINE (AI ONLY PRO)
// =========================
async function getAIResponse(text) {

    // 1. PRIMARY AI
    try {
        const res = await fetch(
            "https://api.affiliateplus.xyz/api/chatbot?message=" +
            encodeURIComponent(text) +
            "&botname=KnightBot"
        );

        const data = await res.json();

        if (data?.message) return data.message.trim();

    } catch (e) {}

    // 2. SECOND AI
    try {
        const res2 = await fetch(
            "https://api.monkedev.com/fun/chat?msg=" +
            encodeURIComponent(text)
        );

        const data2 = await res2.json();

        if (data2?.response) return data2.response.trim();

    } catch (e) {}

    // 3. HF (OPTIONAL)
    try {
        const res3 = await fetch(
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
                    inputs: text,
                    parameters: {
                        max_new_tokens: 80,
                        temperature: 0.8
                    }
                })
            }
        );

        const data3 = await res3.json();

        let reply =
            data3?.generated_text ||
            data3?.[0]?.generated_text;

        if (reply) return reply.trim();

    } catch (e) {}

    // ❌ AI ONLY RULE
    return null;
}

// =========================
// CHATBOT COMMAND
// =========================
async function handleChatbotCommand(sock, chatId, msg, match) {

    const data = loadData();

    const sender =
        msg.key.participant || msg.key.remoteJid;

    const ownerNumber = "233XXXXXXXXX"; // CHANGE THIS

    if (getNumber(sender) !== ownerNumber) {
        return sock.sendMessage(chatId, {
            text: "❌ Only owner can control bot",
            quoted: msg
        });
    }

    if (!match) {
        return sock.sendMessage(chatId, {
            text: ".chatbot on / off",
            quoted: msg
        });
    }

    if (match === "on") {
        data.chatbot[chatId] = true;
        saveData(data);

        return sock.sendMessage(chatId, {
            text: "🤖 AI Bot Enabled",
            quoted: msg
        });
    }

    if (match === "off") {
        delete data.chatbot[chatId];
        saveData(data);

        return sock.sendMessage(chatId, {
            text: "❌ AI Bot Disabled",
            quoted: msg
        });
    }
}

// =========================
// MAIN AI HANDLER
// =========================
async function handleChatbotResponse(sock, chatId, msg, text) {

    const data = loadData();

    if (!data.chatbot[chatId]) return;
    if (!text || msg.key.fromMe) return;

    const botNumber = sock.user.id.split(":")[0];

    const isMentioned = text.includes(botNumber);
    const isReply = msg.message?.extendedTextMessage?.contextInfo?.participant;

    // ONLY RESPOND IF DIRECTED
    if (!isMentioned && !isReply) return;

    const cleanText = text.replace(`@${botNumber}`, "").trim();

    const reply = await getAIResponse(cleanText);

    // ❌ AI ONLY RULE (silent fail)
    if (!reply) return;

    await sock.sendMessage(chatId, {
        text: reply
    }, {
        quoted: msg
    });
}

// =========================
// EXPORTS
// =========================
module.exports = {
    handleChatbotCommand,
    handleChatbotResponse
};