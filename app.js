const chatWindow = document.getElementById("chat-window");
const inputForm = document.getElementById("input-area");
const userInput = document.getElementById("user-input");
const apiKeyInput = document.getElementById("api-key");

// Initialize: Load saved API key from localStorage
window.onload = () => {
  const savedKey = localStorage.getItem("llm_api_key");
  if (savedKey) apiKeyInput.value = savedKey;
};

// Function to append messages to the UI with Tailwind classes
function addMessage(text, sender) {
  const msgDiv = document.createElement("div");

  // Logic for different sender styles
  if (sender === "user") {
    msgDiv.className =
      "max-w-[80%] self-end bg-blue-600 text-white p-4 rounded-2xl rounded-br-none text-sm leading-relaxed shadow-md";
  } else {
    msgDiv.className =
      "max-w-[80%] self-start bg-[#2b2b2b] text-[#ececec] p-4 rounded-2xl rounded-bl-none text-sm leading-relaxed shadow-md";
  }

  msgDiv.innerText = text;
  chatWindow.appendChild(msgDiv);

  // Auto-scroll to bottom
  chatWindow.scrollTo({ top: chatWindow.scrollHeight, behavior: "smooth" });
}

// The "Glue" Logic Loop
async function processQuery(e) {
  e.preventDefault();

  const query = userInput.value.trim();
  const apiKey = apiKeyInput.value.trim();

  if (!query) return;
  if (!apiKey) {
    alert("Please enter your API key in the settings sidebar.");
    return;
  }

  // Persist API key
  localStorage.setItem("llm_api_key", apiKey);

  // 1. Show User Message
  addMessage(query, "user");
  userInput.value = "";

  // 2. Show "Thinking" state
  addMessage("Thinking...", "ai");
  const thinkingBubble = chatWindow.lastChild;

  try {
    // Simulated API Delay
    const response = await simulateLLMResponse(query);
    thinkingBubble.innerText = response;
  } catch (error) {
    thinkingBubble.innerText = "Error: " + error.message;
  }
}

async function simulateLLMResponse(prompt) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(
        "I've analyzed the weather dataset via the MCP SQL tool. In 2024, Germany's average temperature was 10.5°C, with the highest peak in July.",
      );
    }, 1200);
  });
}

inputForm.addEventListener("submit", processQuery);
