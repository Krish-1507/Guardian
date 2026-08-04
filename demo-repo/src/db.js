// Fake in-memory data layer. In a real app this would open a DB connection.
const users = [
  { id: 1, name: "alice", email: "alice@example.com", score: 70 },
  { id: 2, name: "bob", email: "bob@example.com", score: 30 },
  { id: 3, name: "carol", email: "carol@example.com", score: 10 },
];

const posts = [
  { id: 101, userId: 1, title: "Hello" },
  { id: 102, userId: 1, title: "World" },
  { id: 103, userId: 2, title: "Hi" },
];

function query(sql, params) {
  // Pretend this hits the database.
  return [];
}

function getUsers() {
  return users;
}

function getPostsByUser(userId) {
  return posts.filter((p) => p.userId === userId);
}

function getConnection() {
  return { query };
}

module.exports = { query, getUsers, getPostsByUser, getConnection };
