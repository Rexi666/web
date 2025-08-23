import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

const API_KEY = "AIzaSyAtAyvf4qdvWIMmpVg6tnyTq2Cs0zeyYG8";

// Ahora sí puedes inicializar Gemini de la forma correcta
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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

// Respuesta IA (con lógica de reserva)
async function getBotResponse(text) {
  try {
    // Intenta usar la API de Gemini
    const result = await model.generateContent({
      contents: [
        { role: "user", parts: [{ text: text }] }
      ],
      generationConfig: {
        temperature: 0.4,
      },
      safetySettings: [],
      systemInstruction: {
        role: "system",
        parts: [{
          text: `Eres un chatbot especializado en responder preguntas sobre mi (Rexi), un desarrollador de minecraft especializado en la creación, desarrollo y administración de servidores.

Responde de forma clara y concisa.
Si la pregunta no está en tu base de conocimiento, di:
"No tengo información sobre eso".

Rexi tiene experiencia con proyectos de servidores de Minecraft, configuraciones y desarrollo.

La gente puede contactar con él, mediante su servidor de discord: https://discord.com/invite/a3zkKtrjTr

En esta página web, hay una pestaña con sus redes sociales, otra con su experiencia y proyectos, y otra con su contacto`
        }]
      }
    });

    return result.response.text();
  } catch (err) {
    console.error("Error al conectar con la IA de Gemini. Usando respuestas de reserva.", err);
    // Si la API falla, se usa la lógica de reserva
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
