export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  try {
    const response = await fetch("https://mcp.swiggy.com/.well-known/oauth-authorization-server", {
      method: "GET",
      headers: { "Accept": "application/json" }
    });

    const raw = await response.text();

    res.statusCode = 200;
    res.end(JSON.stringify({
      success: true,
      stage: "swiggy_oauth_server_reachable",
      status: response.status,
      bodyPreview: raw.slice(0, 2000)
    }));
  } catch (error) {
    console.error("SWIGGY_NETWORK_TEST_ERROR", error);
    res.statusCode = 500;
    res.end(JSON.stringify({
      success: false,
      stage: "swiggy_network_test_failed",
      error: error?.message || String(error),
      name: error?.name || "Error"
    }));
  }
}
