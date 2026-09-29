export default function handler(req, res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({
    success: true,
    stage: "vercel_function_runtime_ok",
    message: "Fetch Swiggy connect endpoint is running.",
    method: req.method,
    hasConversationId: Boolean(new URL(req.url, "https://" + (req.headers.host || "localhost")).searchParams.get("conversationId"))
  }));
}
