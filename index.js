const express = require('express');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.redirect('/index.html');
});

app.post('/api/chat', async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({
            error: 'GEMINI_API_KEY belum diatur di file .env'
        });
    }

    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
            error: 'Messages harus berupa array yang tidak kosong'
        });
    }

    const validMessages = messages.every(message =>
        message &&
        ['system', 'user', 'assistant'].includes(message.role) &&
        typeof message.content === 'string' &&
        message.content.trim()
    );

    if (!validMessages || !messages.some(message => message.role === 'user')) {
        return res.status(400).json({
            error: 'Setiap pesan harus memiliki role dan content teks yang valid'
        });
    }

    const systemInstruction = messages
        .filter(message => message.role === 'system')
        .map(message => message.content)
        .join('\n');

    const contents = messages
        .filter(message => message.role !== 'system')
        .map(message => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }]
        }));

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:streamGenerateContent?alt=sse`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                body: JSON.stringify({
                    contents,
                    ...(systemInstruction && {
                        systemInstruction: {
                            parts: [{ text: systemInstruction }]
                        }
                    }),
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 1000
                    }
                })
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = errorText;

            try {
                const errorData = JSON.parse(errorText);
                errorMessage = errorData.error?.message || errorText;
            } catch (error) {
                console.error('Respons error Gemini bukan JSON:', error.message);
            }

            console.error(`Gemini API Error (${response.status}):`, errorMessage);
            return res.status(response.status).json({ error: errorMessage });
        }

        if (!response.body) {
            return res.status(502).json({
                error: 'Gemini API tidak mengirimkan data streaming'
            });
        }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const forwardData = data => {
            if (!data || data === '[DONE]') return;

            const chunk = JSON.parse(data);
            const text = chunk.candidates?.[0]?.content?.parts
                ?.map(part => part.text || '')
                .join('');

            if (text) {
                res.write(`data: ${JSON.stringify(text)}\n\n`);
            }
        };

        const processLine = line => {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('data:')) {
                forwardData(trimmedLine.slice(5).trim());
            }
        };

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    processLine(line);
                }
            }

            buffer += decoder.decode();
            if (buffer.trim()) {
                processLine(buffer);
            }

            res.write('data: [DONE]\n\n');
            res.end();
        } finally {
            reader.releaseLock();
        }
    } catch (error) {
        console.error('Gemini chat error:', error);

        if (res.headersSent) {
            if (!res.destroyed) {
                res.write(`event: error\ndata: ${JSON.stringify({
                    error: 'Terjadi kesalahan saat membaca respons Gemini'
                })}\n\n`);
                res.end();
            }
        } else {
            res.status(502).json({
                error: 'Gagal menghubungi Gemini API. Periksa koneksi dan konfigurasi API.'
            });
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});
