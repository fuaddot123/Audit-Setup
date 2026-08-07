// Proxy server-side ke API hari libur publik — dipanggil dari browser lewat /api/hari-libur,
// bukan langsung ke domain luar, biar nggak kena blokir CORS (server-ke-server aman, cuma
// browser-ke-domain-luar yang kena aturan CORS).
export default async function handler(req, res) {
  const year = req.query.year || new Date().getFullYear();
  try {
    const apiRes = await fetch(`https://api-hari-libur.vercel.app/api?year=${year}`);
    const json = await apiRes.json();
    res.status(200).json(json);
  } catch (err) {
    res.status(500).json({ status: "error", data: [], message: err.message });
  }
}
