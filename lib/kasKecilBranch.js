export function sheetKeyForBranch(name) {
  const key = String(name || "").trim().replace(/\s+/g, " ").toUpperCase();
  return {
    YOGYAKARTA: "JOGJA",
    "SURABAYA MERR": "SURABAYA",
    "SURABAYA BABATAN": "BABATAN",
  }[key] || key;
}
