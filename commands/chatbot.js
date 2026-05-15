const fs = require("fs");
const fetch = require("node-fetch");

// =========================
// GROUP DATA
// =========================
const GROUP_FILE = "./userGroupData.json";

function loadData() {
    try {
        return JSON.parse(fs.readFileSync(GROUP_FILE, "utf8"));
    } catch {
        return { chatbot: {} };
    }
}

function saveData(data) {
    fs.writeFileSync(GROUP_FILE, JSON.stringify(data, null, 2));
}

// =========================
// UTIL: GET NUMBER
// =========================
function getNumber(jid = "") {
    return jid.split("@")[0].split(":")[0];
}

// =========================
// FREE AI ENGINE (MULTI API)
// =========================
async function getAIResponse(text) {

    // 🔥 1. AFFILIATEPLUS (FAST)
    try {
        const res = await fetch(
            "https://api.affiliateplus.xyz/api/chatbot?message=" +
            encodeURIComponent(text) +
            "&botname=KnightBot"
        );

        const data = await res.json();

        if (data?.message) return data.message.trim();

    } catch (e) {}

    // 🔥 2. MONKEDEV (STABLE FREE AI)
    try {
        const res2 = await fetch(
            "https://api.monkedev.com/fun/chat?msg=" +
            encodeURIComponent(text)
        );

        const data2 = await res2.json();

        if (data2?.response) return data2.response.trim();

    } catch (e) {}

    // 🔥 3. DIALOGPT FREE (HF PUBLIC MODEL - NO KEY)
    try {
        const res3 = await fetch(
            "https://api-inference.huggingface.co/models/microsoft/DialoGPT-medium",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    inputs: text
                })
            }
        );

        const data3 = await res3.json();

        let reply =
            data3?.generated_text ||
            data3?.[0]?.generated_text;

        if (reply) return reply.trim();

    } catch (e) {}

    // ❌ AI ONLY RULE: silent fail
    return null;
}

// =========================
// CHATBOT COMMAND (.chatbot on/off)
// =========================
async function handleChatbotCommand(sock, chatId, msg, match) {

    const data = loadData();

    const sender =
        msg.key.participant || msg.key.remoteJid;

    const senderNumber = getNumber(sender);

    const OWNER_NUMBER = "233XXXXXXXXX"; // 🔴 CHANGE THIS

    // OWNER CHECK (FIXED SIMPLE STYLE)
    if (senderNumber !== OWNER_NUMBER) {
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
    const isReply =
        msg.message?.extendedTextMessage?.contextInfo?.participant;

    // ONLY REPLY WHEN DIRECTED
    if (!isMentioned && !isReply) return;

    const cleanText = text.replace(`@${botNumber}`, "").trim();

    const reply = await getAIResponse(cleanText);

    // ❌ AI ONLY MODE
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