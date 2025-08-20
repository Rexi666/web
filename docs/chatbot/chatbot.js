const messages = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const chatbox = document.getElementById('chatbox');
const chatToggleBtn = document.getElementById('chatToggleBtn');
const closeChatBtn = document.getElementById('closeChatBtn');

function addMessage(text, sender) {
  const div = document.createElement('div');
  div.classList.add('message', sender);
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function getBotResponse(text) {
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

sendBtn.addEventListener('click', () => {
  const userText = input.value.trim();
  if (userText === '') return;
  addMessage(userText, 'user');
  input.value = '';
  setTimeout(() => {
    addMessage(getBotResponse(userText), 'bot');
  }, 500);
});

input.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendBtn.click();
});

chatToggleBtn.addEventListener('click', () => {
  chatbox.style.display = 'flex';
  chatToggleBtn.style.display = 'none';
});

closeChatBtn.addEventListener('click', () => {
  chatbox.style.display = 'none';
  chatToggleBtn.style.display = 'flex';
});
