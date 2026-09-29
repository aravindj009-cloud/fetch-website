export default async function handler(req, res) {
  res.status(200);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end("<h2>Swiggy callback endpoint is ready.</h2><p>OAuth callback wiring will be completed in the next deployment.</p>");
}