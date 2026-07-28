const NVIDIA_API_KEY = "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";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const NVIDIA_MODEL = "meta/llama-3.3-70b-instruct";

const PROXY_URL = 'https://oixknmspnswjbsncefwl.supabase.co/functions/v1/super-service';

// DOM
const messages = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const chatbox = document.getElementById('chatbox');
const chatToggleBtn = document.getElementById('chatToggleBtn');
const closeChatBtn = document.getElementById('closeChatBtn');

// Añadir mensajes
function addMessage(text, sender) {
  const div = document.createElement('div');
  div.classList.add('message', sender);
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

// Lógica de respuesta de reserva (fallback)
function getFallbackResponse(text) {
  text = text.toLowerCase();
  if (text.includes('hola')) {
    return '¡Hola! ¿En qué puedo ayudarte?';
  } else if (text.includes('proyecto') || text.includes('ayuda') || text.includes('experiencia')) {
    return 'Rexi tiene experiencia con proyectos de servidores de Minecraft, configuraciones y desarrollo. Tienes su contacto en la página dedicada.';
  } else if (text.includes('discord') || text.includes('contact')) {
    return 'Únete al servidor de Discord para contacto: https://discord.com/invite/a3zkKtrjTr';
  } else if (text.includes('redes') || text.includes('sociales')) {
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

// Respuesta IA (con lógica de reserva)
async function getBotResponse(text) {
  try {
    const targetEndpoint = `${NVIDIA_BASE_URL}/chat/completions`;

    const response = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${NVIDIA_API_KEY}`
      },
      body: JSON.stringify({
        targetUrl: targetEndpoint,
        model: NVIDIA_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text }
        ],
        temperature: 0.4,
        max_tokens: 1024
      })
    });

    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }

    const data = await response.json();

    // Comprobar si devolvió una respuesta válida de la API
    if (data.choices && data.choices[0] && data.choices[0].message) {
      return data.choices[0].message.content;
    } else if (data.error) {
      throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    } else {
      throw new Error("Estructura de respuesta no válida");
    }

  } catch (err) {
    console.error("Error al conectar con la IA de NVIDIA mediante el proxy. Usando respuestas de reserva.", err);
    // Si la API o el proxy fallan, se usa la lógica de reserva
    return getFallbackResponse(text);
  }
}

// Enviar mensaje
sendBtn.addEventListener('click', async () => {
  const userText = input.value.trim();
  if (userText === '') return;

  addMessage(userText, 'user');
  input.value = '';

  addMessage("Escribiendo...", 'bot');
  const botResponse = await getBotResponse(userText);
  messages.lastChild.textContent = botResponse;
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
