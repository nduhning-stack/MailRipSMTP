// server/server.js
const express = require('express');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

const app = express();
app.use(helmet());
app.use(bodyParser.json());
app.use(cors());

// Simple rate limiter (adjust as needed)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 120,             // limit each IP to 120 requests per windowMs
  message: { error: "Too many requests, slow down." }
});
app.use('/auth', apiLimiter);

// In-memory "allowed" credentials — for testing only
const testUsers = new Map([
  ['alice@example.com', 'Password123!'],
  ['bob@example.com', 'hunter2'],
  ['testuser', 'letmein']
]);

// Simple auth endpoint for testing
app.post('/auth', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ ok: false, error: 'Missing username or password' });
  }

  // Simulate processing time (helps test concurrency)
  setTimeout(() => {
    const correct = testUsers.get(username);
    if (correct && correct === password) {
      // Example response (do NOT use to mimic real service responses)
      return res.json({ ok: true, username, msg: 'Authenticated (test server)' });
    } else {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }
  }, 200 + Math.random() * 300); // 200-500ms simulated delay
});

// Optional: endpoint to query server info
app.get('/', (req, res) => {
  res.send('Mock combo-checker auth server. POST /auth with {username,password} JSON.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mock auth server listening at http://localhost:${PORT}`);
});
