const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

const { initDB, getUser, addUser, getAllUsers, deleteUser, updateUser } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // Change in production!

// Initialize database
initDB();

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.redirect('/login');
  }
}

// Login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// Login POST
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  getUser(username, (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Compare passwords
    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) {
        return res.status(500).json({ error: 'Authentication error' });
      }

      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Set session
      req.session.userId = user.id;
      req.session.username = user.username;
      res.json({ success: true, redirect: '/' });
    });
  });
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout error' });
    }
    res.redirect('/login');
  });
});

// Dashboard (protected)
app.get('/', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve other dashboard pages (protected)
app.get('/command-center/*', isAuthenticated, (req, res) => {
  const file = req.path.replace('/command-center/', '');
  res.sendFile(path.join(__dirname, 'command-center', file));
});

app.get('/denials/*', isAuthenticated, (req, res) => {
  const file = req.path.replace('/denials/', '');
  res.sendFile(path.join(__dirname, 'denials', file));
});

app.get('/infusion/*', isAuthenticated, (req, res) => {
  const file = req.path.replace('/infusion/', '');
  res.sendFile(path.join(__dirname, 'infusion', file));
});

app.get('/referral-intake/*', isAuthenticated, (req, res) => {
  const file = req.path.replace('/referral-intake/', '');
  res.sendFile(path.join(__dirname, 'referral-intake', file));
});

app.get('/s3-orders/*', isAuthenticated, (req, res) => {
  const file = req.path.replace('/s3-orders/', '');
  res.sendFile(path.join(__dirname, 's3-orders', file));
});

// Admin panel - Add new client
app.get('/admin', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Admin API to get all users
app.get('/api/users', isAuthenticated, (req, res) => {
  const adminPassword = req.headers['x-admin-pass'];
  
  if (adminPassword !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Admin access denied' });
  }

  getAllUsers((err, users) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(users);
  });
});

// Admin API to add user
app.post('/api/users', isAuthenticated, (req, res) => {
  const adminPassword = req.headers['x-admin-pass'];
  
  if (adminPassword !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Admin access denied' });
  }

  const { username, password, email } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  // Hash password
  bcrypt.hash(password, 10, (err, hashedPassword) => {
    if (err) {
      return res.status(500).json({ error: 'Encryption error' });
    }

    addUser(username, hashedPassword, email, (err) => {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'Username already exists' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ success: true, message: 'User added successfully' });
    });
  });
});

// Admin API to delete user
app.delete('/api/users/:id', isAuthenticated, (req, res) => {
  const adminPassword = req.headers['x-admin-pass'];
  
  if (adminPassword !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Admin access denied' });
  }

  const { id } = req.params;

  deleteUser(id, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ success: true, message: 'User deleted successfully' });
  });
});

// Check session (for frontend)
app.get('/api/session', (req, res) => {
  if (req.session.userId) {
    res.json({ authenticated: true, username: req.session.username });
  } else {
    res.json({ authenticated: false });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔐 Admin panel: http://localhost:${PORT}/admin`);
});
