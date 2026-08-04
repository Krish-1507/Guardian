const service = require("./userService");
const db = require("./db");

function list(req, res) {
  const users = service.listUsersWithPosts();
  res.json(users);
}

function render(users) {
  // --- DUPLICATED BLOCK (start) ---
  return users.map((u) => {
    const name = (u.name || "").toUpperCase();
    const email = (u.email || "").toLowerCase();
    const score = (u.score || 0) + 10;
    const tier = score > 50 ? "gold" : score > 20 ? "silver" : "bronze";
    const summary = `${name} <${email}> [${tier}]`;
    return { id: u.id, summary, score };
  });
  // --- DUPLICATED BLOCK (end) ---
}

module.exports = { list, render };
