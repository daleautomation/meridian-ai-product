const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  throw new Error("Missing ANTHROPIC_API_KEY in environment variables");
}

type ClaudeMessage = {
  role: "user" | "assistant";
  content: string;
};

export async function callClaude(messages: ClaudeMessage[], system?: string) {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        temperature: 0.4,
        system: system || "You are a high-performance decision engine.",
        messages
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    return data.content?.[0]?.text || "No response from Claude";
  } catch (error) {
    console.error("Claude Error:", error);
    throw error;
  }
}
