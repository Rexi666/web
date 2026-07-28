const NVIDIA_API_KEY = "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";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const NVIDIA_MODEL = "meta/llama-3.3-70b-instruct";

// Proxy de Cloudflare
const PROXY_URL = 'https://proxy.antonferv.workers.dev/';

// DOM
const messagesContainer = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const chatbox = document.getElementById('chatbox');
const chatToggleBtn = document.getElementById('chatToggleBtn');
const closeChatBtn = document.getElementById('closeChatBtn');

// Estado de la conversación
let chatHistory = [];

// Añadir mensajes al DOM
function addMessage(text, sender) {
  const div = document.createElement('div');
  div.classList.add('message', sender);
  div.textContent = text;
  messagesContainer.appendChild(div);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Lógica de respuesta de reserva (fallback)
function getFallbackResponse(text) {
  const lowerText = text.toLowerCase();
  if (lowerText.includes('hola')) {
    return '¡Hola! ¿En qué puedo ayudarte?';
  } else if (lowerText.includes('proyecto') || lowerText.includes('ayuda') || lowerText.includes('experiencia')) {
    return 'Rexi tiene experiencia con proyectos de servidores de Minecraft, configuraciones y desarrollo. Tienes su contacto en la página dedicada.';
  } else if (lowerText.includes('discord') || lowerText.includes('contact')) {
    return 'Únete al servidor de Discord para contacto: https://discord.com/invite/a3zkKtrjTr';
  } else if (lowerText.includes('redes') || lowerText.includes('sociales')) {
    return 'Tienes las redes sociales en la página dedicada.';
  } else {
    return 'Lo siento, no entiendo tu pregunta. ¿Puedes reformularla? (Palabras clave: experiencia, discord, redes)';
  }
}

const SYSTEM_PROMPT = `Eres un chatbot especializado en responder preguntas sobre mi (Rexi), un desarrollador de minecraft especializado en la creación, desarrollo y administración de servidores.

Responde de forma clara y concisa.
Si la pregunta no está en tu base de conocimiento, di:
"No tengo información sobre eso".

Rexi tiene experiencia con proyectos de servidores de Minecraft, configuraciones y desarrollo.

La gente puede contactar con él, mediante su servidor de discord: https://discord.com/invite/a3zkKtrjTr

En esta página web, hay una pestaña con sus redes sociales, otra con su experiencia y proyectos, y otra con su contacto`;

// Función auxiliar para esperar X milisegundos
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Respuesta IA (con reintentos automáticos si Supabase está saturado)
async function getBotResponse(userText, retries = 2) {
  const apiMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...chatHistory,
    { role: "user", content: userText }
  ];

  const targetEndpoint = `${NVIDIA_BASE_URL}/chat/completions`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${NVIDIA_API_KEY}`,
        },
        body: JSON.stringify({
          targetUrl: targetEndpoint,
          model: NVIDIA_MODEL,
          messages: apiMessages,
          temperature: 0.4,
          max_tokens: 1024,
          stream: false,
        }),
      });

      const responseText = await res.text();

      // Si nos da 503 (Worker ocupado) y aún nos quedan reintentos, esperamos y reintentamos
      if (res.status === 503 && attempt < retries) {
        console.warn(`Supabase ocupado (503). Reintentando (${attempt + 1}/${retries})...`);
        await sleep(2000); // Espera 2 segundos antes de reintentar
        continue;
      }

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const errJson = JSON.parse(responseText);
          errMsg = errJson?.error?.message || errJson?.error || errMsg;
        } catch { }
        throw new Error(errMsg);
      }

      const data = JSON.parse(responseText);
      const reply = data?.choices?.[0]?.message?.content;

      if (!reply) throw new Error("Respuesta vacía o formato inválido");

      chatHistory.push({ role: "user", content: userText });
      chatHistory.push({ role: "assistant", content: reply });

      return reply;

    } catch (err) {
      if (attempt === retries) {
        console.error("Error al conectar con la IA tras varios intentos. Usando respuestas de reserva.", err);
        return getFallbackResponse(userText);
      }
    }
  }
}

// Enviar mensaje (protegido contra clics dobles)
let isSending = false;

sendBtn.addEventListener('click', async () => {
  const userText = input.value.trim();
  if (userText === '' || isSending) return;

  isSending = true;
  sendBtn.disabled = true;
  input.disabled = true;

  addMessage(userText, 'user');
  input.value = '';

  addMessage("Escribiendo...", 'bot');
  const botResponse = await getBotResponse(userText);

  messagesContainer.lastChild.textContent = botResponse;

  isSending = false;
  sendBtn.disabled = false;
  input.disabled = false;
  input.focus();
});

input.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendBtn.click();
});

// Abrir/cerrar chat
chatToggleBtn.addEventListener('click', () => {
  chatbox.style.display = 'flex';
  chatToggleBtn.style.display = 'none';
});

closeChatBtn.addEventListener('click', () => {
  chatbox.style.display = 'none';
  chatToggleBtn.style.display = 'flex';
});
