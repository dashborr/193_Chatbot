const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const chatMessages = document.getElementById('chat-messages');
const sendButton = document.getElementById('send-button');

let conversationHistory = [];

chatForm.addEventListener('submit', async event => {
    event.preventDefault();

    const text = userInput.value.trim();
    if (!text) return;

    userInput.value = '';
    userInput.disabled = true;
    sendButton.disabled = true;

    appendMessage(text, 'user-message');
    conversationHistory.push({ role: 'user', content: text });

    const aiMessageDiv = appendMessage('', 'ai-message');

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ messages: conversationHistory })
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = errorText;

            try {
                const errorData = JSON.parse(errorText);
                errorMessage = errorData.error || errorText;
            } catch (error) {
                console.error('Respons error server bukan JSON:', error.message);
            }

            throw new Error(errorMessage || `Request gagal (${response.status})`);
        }

        if (!response.body) {
            throw new Error('Browser tidak mendukung pembacaan streaming');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullResponse = '';

        const processEvent = eventBlock => {
            const lines = eventBlock.split('\n');
            const eventType = lines
                .find(line => line.startsWith('event:'))
                ?.slice(6)
                .trim();
            const data = lines
                .filter(line => line.startsWith('data:'))
                .map(line => line.slice(5).trim())
                .join('\n');

            if (eventType === 'error') {
                let message = data;
                try {
                    message = JSON.parse(data).error || data;
                } catch (error) {
                    console.error('Event error server bukan JSON:', error.message);
                }
                throw new Error(message);
            }

            if (!data || data === '[DONE]') return;

            const chunk = JSON.parse(data);
            if (typeof chunk !== 'string') return;

            fullResponse += chunk;
            aiMessageDiv.textContent = '';
            if (window.marked) {
                aiMessageDiv.innerHTML = window.marked.parse(fullResponse);
            } else {
                aiMessageDiv.textContent = fullResponse;
            }
            scrollToBottom();
        };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
            const events = buffer.split('\n\n');
            buffer = events.pop();

            for (const eventBlock of events) {
                if (eventBlock.trim()) processEvent(eventBlock);
            }
        }

        buffer += decoder.decode();
        if (buffer.trim()) processEvent(buffer);

        if (!fullResponse) {
            throw new Error('Gemini tidak mengirimkan teks balasan');
        }

        conversationHistory.push({
            role: 'assistant',
            content: fullResponse
        });
    } catch (error) {
        console.error('Chat error:', error);
        aiMessageDiv.textContent = '';

        const errorMessage = document.createElement('span');
        errorMessage.className = 'message-error';
        errorMessage.textContent = `Gagal menerima pesan: ${error.message}`;
        aiMessageDiv.appendChild(errorMessage);
        scrollToBottom();
    } finally {
        userInput.disabled = false;
        sendButton.disabled = false;
        userInput.focus();
    }
});

function appendMessage(text, className) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${className}`;

    if (className === 'ai-message' && !text) {
        const typing = document.createElement('em');
        typing.textContent = 'Mengetik...';
        messageDiv.appendChild(typing);
    } else {
        messageDiv.textContent = text;
    }

    chatMessages.appendChild(messageDiv);
    scrollToBottom();
    return messageDiv;
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}
