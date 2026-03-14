# auhack2026
auhack winners 2026

Phase 1: The Static Frontend
Goal: A UI that looks the part.

[ ] index.html: Create a single-page layout with a scrollable chat window and a sticky bottom input bar.

[ ] style.css: Use a clean, "AI-dark-mode" aesthetic. Keep it minimal.

[ ] Settings UI: Add a small gear icon that opens a drawer to input:

LLM API Key (OpenAI or Anthropic).

MCP Server URL (default to http://localhost:3000).

Phase 2: The LLM Connection
Goal: Get the prompt to the AI and back.

[ ] app.js: Write a function askLLM(prompt) that uses fetch to call the OpenAI/Anthropic API directly.

[ ] Render Chat: Display the user message immediately and show a "typing..." bubble while waiting for the response.

[ ] Tool-Call Logic: Update the LLM call to include a tools definition (this tells the AI it can search your database).

Phase 3: The MCP Server (The "Bridge")
Goal: A simple Node.js script to hold the data.

[ ] Initialize: Create a server.js using the @modelcontextprotocol/sdk.

[ ] Mock Database: Create a data.json file with some sample entries (e.g., a list of products or employees).

[ ] Register Tool: Create a tool called search_items that takes a string query and returns matching rows from your JSON file.

[ ] CORS: Ensure the MCP server allows requests from your local HTML file.

Phase 4: Connecting the Glue
Goal: LLM actually uses the tool.

[ ] The Loop:

User asks a question.

Frontend sends prompt to LLM.

LLM returns a "Tool Call" (wants to search the DB).

Frontend executes that search against the Local MCP Server.

Frontend sends the DB results back to the LLM.

LLM gives the final answer to the user.