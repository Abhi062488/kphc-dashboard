const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'auth.db');
const db = new sqlite3.Database(dbPath);

// Initialize database
function initDB() {
  db.serialize(() => {
    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('Error creating users table:', err);
      else console.log('Users table initialized');
    });
  });
}

function getUser(username, callback) {
  db.get('SELECT * FROM users WHERE username = ?', [username], callback);
}

function addUser(username, hashedPassword, email, callback) {
  db.run(
    'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
    [username, hashedPassword, email],
    callback
  );
}

function getAllUsers(callback) {
  db.all('SELECT id, username, email, created_at FROM users', callback);
}

function deleteUser(id, callback) {
  db.run('DELETE FROM users WHERE id = ?', [id], callback);
}

function updateUser(id, username, email, callback) {
  db.run(
    'UPDATE users SET username = ?, email = ? WHERE id = ?',
    [username, email, id],
    callback
  );
}

module.exports = {
  db,
  initDB,
  getUser,
  addUser,
  getAllUsers,
  deleteUser,
  updateUser
};
