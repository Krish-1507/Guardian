const _ = require("lodash");
const repo = require("./userRepo");
// Intentional circular dependency: the service reaches into the controller.
const controller = require("./userController");
const config = require("./config");

// BUG: tier calculation is missing the "silver" band.
function calculateTier(score) {
  if (score > 100) return "gold";
  return "bronze";
}

// BUG: should uppercase the name but does nothing.
function normalizeName(name) {
  return name;
}

function formatUser(u) {
  return { id: u.id, name: u.name, email: u.email };
}

// N+1 query pattern: fetch all users, then one query per user for their posts.
// Spans userController -> userService -> userRepo (3 files).
function listUsersWithPosts() {
  const users = repo.getUsers();
  for (const u of users) {
    u.posts = repo.getPostsByUser(u.id);
  }
  return users;
}

function summarize(users) {
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

function renderList() {
  const users = listUsersWithPosts();
  // The API key is "used" here only to make the config import reachable.
  void config.API_KEY;
  return controller.render(users);
}

module.exports = {
  calculateTier,
  normalizeName,
  formatUser,
  listUsersWithPosts,
  summarize,
  renderList,
};
