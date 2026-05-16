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
                text: "Hmm, let me think about that... 🤔\nI'm having trouble processing your request right now.",
                quoted: message
            });
            return;
        }

        // human delay
        await new Promise(resolve => setTimeout(resolve, getRandomDelay()));

        await sock.sendMessage(chatId, {
            text: response
        }, {
            quoted: message
        });

    } catch (error) {
        console.error("❌ Error in chatbot response:", error.message);

        if (error.message?.includes("No sessions")) return;

        try {
            await sock.sendMessage(chatId, {
                text: "Oops! 😅 I got confused. Try again?",
                quoted: message
            });
        } catch (e) {
            console.error("Send error:", e.message);
        }
    }
}


/**
 * OPENROUTER AI FUNCTION (REPLACEMENT)
 */
async function getAIResponse(userMessage, userContext) {
    try {
        const prompt = `
You are Knight Bot. A natural WhatsApp conversational assistant.

RULES:
- Short replies (1–2 lines)
- Natural human tone
- No explanations of rules
- Be casual and friendly

Chat history:
${userContext.messages.join("\n")}

User info:
${JSON.stringify(userContext.userInfo)}

User: ${userMessage}
Reply naturally:
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
                    { role: "system", content: "You are a helpful WhatsApp chatbot." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.8,
                max_tokens: 120
            })
        });

        const data = await res.json();

        if (!data?.choices?.[0]?.message?.content) {
            console.error("Invalid OpenRouter response:", data);
            return null;
        }

        return data.choices[0].message.content.trim();

    } catch (error) {
        console.error("OpenRouter error:", error.message);
        return null;
    }
}


/**
 * RANDOM DELAY (human feel)
 */
function getRandomDelay() {
    return Math.floor(Math.random() * 1500) + 800;
}

module.exports = {
    handleChatbotResponse,
    getAIResponse
};