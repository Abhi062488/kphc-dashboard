const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

const { initDB, getUser, addUser, getAllUsers, deleteUser, updateUser } = require('./db');
const ScalpingBotEngine = require('./trading-bot/bot-engine');

// Initialize Trading Bot
const tradingBot = new ScalpingBotEngine();

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

// ============================================
// TRADING BOT API ROUTES
// ============================================

// Trading bot dashboard page
app.get('/trading-bot', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'trading-bot', 'dashboard.html'));
});

// Get current bot state and analysis
app.get('/api/trading-bot/state', isAuthenticated, async (req, res) => {
  try {
    const state = tradingBot.getState();
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get live market analysis
app.get('/api/trading-bot/analysis', isAuthenticated, async (req, res) => {
  try {
    // Try live data first, fall back to demo
    await tradingBot.initialize();
    await tradingBot.tick();

    const state = tradingBot.getState();
    if (state.signals.length === 0 && tradingBot.signals.length === 0) {
      // No live data available, send demo
      const demo = tradingBot.generateDemoData();
      res.json(demo);
    } else {
      res.json({
        analysis: tradingBot._lastAnalysis || tradingBot.generateDemoData().analysis,
        signals: state.signals,
        positions: state.positions,
        pnl: state.pnl,
        timestamp: new Date().toISOString(),
        isDemo: false,
      });
    }
  } catch (err) {
    // Fallback to demo data
    const demo = tradingBot.generateDemoData();
    res.json(demo);
  }
});

// Get demo data (for testing / off-market hours)
app.get('/api/trading-bot/demo', isAuthenticated, (req, res) => {
  const demo = tradingBot.generateDemoData();
  res.json(demo);
});

// Start the bot
app.post('/api/trading-bot/start', isAuthenticated, async (req, res) => {
  try {
    await tradingBot.initialize();
    tradingBot.start();
    res.json({ success: true, message: 'Bot started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stop the bot
app.post('/api/trading-bot/stop', isAuthenticated, (req, res) => {
  tradingBot.stop();
  res.json({ success: true, message: 'Bot stopped' });
});

// Add a position (user accepts a signal)
app.post('/api/trading-bot/position', isAuthenticated, (req, res) => {
  const signal = req.body;
  if (!signal || !signal.instrument) {
    return res.status(400).json({ error: 'Invalid signal data' });
  }
  const position = tradingBot.addPosition(signal);
  res.json({ success: true, position });
});

// Close a position manually
app.post('/api/trading-bot/position/:id/close', isAuthenticated, (req, res) => {
  const { id } = req.params;
  const pos = tradingBot.activePositions.find(p => p.id === id);
  if (!pos) {
    return res.status(404).json({ error: 'Position not found' });
  }
  pos.status = 'MANUAL_CLOSE';
  tradingBot.closePosition(pos, 'Manual close');
  tradingBot.cleanPositions();
  res.json({ success: true, message: 'Position closed' });
});

// Update bot configuration
app.put('/api/trading-bot/config', isAuthenticated, (req, res) => {
  const newConfig = req.body;
  tradingBot.updateConfig(newConfig);
  res.json({ success: true, config: tradingBot.config });
});

// Get trade history
app.get('/api/trading-bot/trades', isAuthenticated, (req, res) => {
  res.json({
    trades: tradingBot.pnl.trades,
    summary: {
      totalTrades: tradingBot.pnl.trades.length,
      realizedPnL: tradingBot.pnl.realized,
      winRate: tradingBot.calculateWinRate(),
    }
  });
});

// SSE endpoint for real-time updates
app.get('/api/trading-bot/stream', isAuthenticated, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const sendUpdate = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send initial data
  const demo = tradingBot.generateDemoData();
  sendUpdate(demo);

  // Listen for updates
  tradingBot.on('update', sendUpdate);
  tradingBot.on('trade_closed', (trade) => {
    sendUpdate({ type: 'trade_closed', trade });
  });

  // Send periodic demo updates if bot not running
  const demoInterval = setInterval(() => {
    if (!tradingBot.running) {
      const demo = tradingBot.generateDemoData();
      sendUpdate(demo);
    }
  }, 5000);

  req.on('close', () => {
    clearInterval(demoInterval);
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
