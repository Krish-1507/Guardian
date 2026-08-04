const db = require("./db");
// Intentional layering violation: the repository reaches back up to the service.
const userService = require("./userService");

function getUsers() {
  return db.getUsers();
}

function getPostsByUser(userId) {
  return db.getPostsByUser(userId);
}

function getUserSummary(id) {
  const u = db.getUsers().find((x) => x.id === id);
  return userService.formatUser(u);
}

module.exports = { getUsers, getPostsByUser, getUserSummary };
