const fetch = require("node-fetch");
require("dotenv").config();

/**
 * MAIN CHATBOT RESPONSE HANDLER
 */
async function handleChatbotResponse(sock, chatId, message, userMessage, senderId, chatMemory) {
    try {
        const response = await getAIResponse(userMessage, {
            messages: chatMemory.messages.get(senderId) || [],
            userInfo: chatMemory.userInfo.get(senderId) || {}
        });

        if (!response) {
            await sock.sendMessage(chatId, {
                text: "Hmm 🤔 I couldn't process that right now. Try again.",
                quoted: message
            });
            return;
        }

        await new Promise(r => setTimeout(r, getRandomDelay()));

        await sock.sendMessage(chatId, {
            text: response
        }, {
            quoted: message
        });

    } catch (error) {
        console.error("❌ Chatbot handler error:", error.message);

        try {
            await sock.sendMessage(chatId, {
                text: "⚠️ AI temporarily unavailable. Try again later.",
                quoted: message
            });
        } catch (e) {
            console.error("Send error:", e.message);
        }
    }
}


/**
 * OPENROUTER AI FUNCTION (FIXED)
 */
async function getAIResponse(userMessage, userContext) {
    try {
        if (!process.env.OPENROUTER_API_KEY) {
            console.error("❌ Missing OPENROUTER_API_KEY");
            return null;
        }

        const prompt = `
You are Knight Bot.
Reply naturally in 1–2 short lines.

Chat history:
${userContext.messages.join("\n")}

User info:
${JSON.stringify(userContext.userInfo)}

User: ${userMessage}
        `.trim();

        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://localhost",
                "X-Title": "KnightBot"
            },
            body: JSON.stringify({
                model: "meta-llama/llama-3.1-8b-instruct:free",
                messages: [
                    { role: "user", content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 120
            })
        });

        const text = await res.text();

        let data;
        try {
            data = JSON.parse(text);
        } catch (err) {
            console.error("❌ Invalid JSON from OpenRouter:", text);
            return null;
        }

        if (!res.ok) {
            console.error("❌ OpenRouter HTTP Error:", data);
            return null;
        }

        const reply = data?.choices?.[0]?.message?.content;

        if (!reply) {
            console.error("❌ Empty AI response:", data);
            return null;
        }

        return reply.trim();

    } catch (error) {
        console.error("🔥 OpenRouter crash:", error.message);
        return null;
    }
}


/**
 * RANDOM HUMAN DELAY
 */
function getRandomDelay() {
    return Math.floor(Math.random() * 1500) + 800;
}

module.exports = {
    handleChatbotResponse,
    getAIResponse
};