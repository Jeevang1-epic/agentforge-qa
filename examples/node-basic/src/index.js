export function formatGreeting(name) {
  const safeName = String(name).trim();

  return `Hello, ${safeName.length > 0 ? safeName : "AgentForge"}.`;
}
