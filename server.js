require('dotenv').config();

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const app = express();

// CORS Configuration - Allow requests from your Netlify domain
const cors = require('cors');
app.use(cors({
  origin: [
    'https://illustrious-figolla-65c203.netlify.app',
    'http://localhost:3000',
    'http://localhost:5000',
    /\.netlify\.app$/  // Allow all Netlify domains
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const UNBIND_COOLDOWN_MINUTES = 5;

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5
});

function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let key = '';
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) key += '-';
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  req.userId = decoded.userId;
  next();
}

async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS licenses (
        license_key VARCHAR(19) PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'active',
        platform VARCHAR(10),
        account_number VARCHAR(50),
        broker VARCHAR(100),
        bound_at TIMESTAMP,
        last_validated TIMESTAMP,
        expires_at TIMESTAMP,
        purchase_order_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS activations (
        id SERIAL PRIMARY KEY,
        license_key VARCHAR(19) REFERENCES licenses(license_key),
        platform VARCHAR(10),
        account_number VARCHAR(50),
        action VARCHAR(20),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45)
      );

      CREATE TABLE IF NOT EXISTS cooldowns (
        license_key VARCHAR(19) PRIMARY KEY REFERENCES licenses(license_key),
        last_unbind TIMESTAMP,
        next_allowed_unbind TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_licenses_user ON licenses(user_id);
      CREATE INDEX IF NOT EXISTS idx_activations_license ON activations(license_key);
    `);
    console.log('Database initialized successfully');
  } finally {
    client.release();
  }
}

app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, created_at',
      [email.toLowerCase(), passwordHash, name || email.split('@')[0]]
    );

    const user = result.rows[0];
    const token = generateToken(user.id);

    res.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name },
      token
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ message: 'Registration failed' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    const result = await pool.query(
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = result.rows[0];

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = generateToken(user.id);

    res.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name },
      token
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Login failed' });
  }
});

app.post('/api/validate', apiLimiter, async (req, res) => {
  try {
    const { license_key, account_number, platform, broker } = req.body;

    if (!license_key || !account_number || !platform) {
      return res.status(400).json({ 
        valid: false, 
        message: 'Missing required parameters' 
      });
    }

    const result = await pool.query(
      'SELECT * FROM licenses WHERE license_key = $1',
      [license_key.toUpperCase()]
    );

    if (result.rows.length === 0) {
      return res.json({ 
        valid: false, 
        message: 'Invalid license key' 
      });
    }

    const license = result.rows[0];

    if (license.expires_at && new Date(license.expires_at) < new Date()) {
      return res.json({ 
        valid: false, 
        message: 'License expired' 
      });
    }

    if (license.status !== 'active') {
      return res.json({ 
        valid: false, 
        message: 'License is not active' 
      });
    }

    if (!license.account_number) {
      await pool.query(
        `UPDATE licenses 
         SET platform = $1, account_number = $2, broker = $3, 
             bound_at = CURRENT_TIMESTAMP, last_validated = CURRENT_TIMESTAMP
         WHERE license_key = $4`,
        [platform, account_number, broker, license_key.toUpperCase()]
      );

      await pool.query(
        `INSERT INTO activations (license_key, platform, account_number, action, ip_address)
         VALUES ($1, $2, $3, 'bind', $4)`,
        [license_key.toUpperCase(), platform, account_number, req.ip]
      );

      return res.json({ 
        valid: true, 
        message: 'License activated successfully',
        expires: license.expires_at
      });
    }

    if (license.platform === platform && license.account_number === account_number) {
      await pool.query(
        'UPDATE licenses SET last_validated = CURRENT_TIMESTAMP WHERE license_key = $1',
        [license_key.toUpperCase()]
      );

      return res.json({ 
        valid: true, 
        message: 'License valid',
        expires: license.expires_at
      });
    }

    return res.json({ 
      valid: false, 
      message: `License is bound to ${license.platform} account ${license.account_number}` 
    });

  } catch (err) {
    console.error('Validation error:', err);
    res.status(500).json({ 
      valid: false, 
      message: 'Validation failed' 
    });
  }
});

app.get('/api/licenses/user/:userId', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT license_key, status, platform, account_number as bound_account, broker, 
              bound_at, last_validated, expires_at, created_at,
              CASE WHEN status = 'active' THEN true ELSE false END as is_active
       FROM licenses 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [req.userId]
    );

    const licensesWithCooldown = await Promise.all(
      result.rows.map(async (license) => {
        const cooldown = await pool.query(
          'SELECT last_unbind, next_allowed_unbind FROM cooldowns WHERE license_key = $1',
          [license.license_key]
        );

        return {
          ...license,
          last_unbind_time: cooldown.rows.length > 0 ? cooldown.rows[0].last_unbind : null
        };
      })
    );

    res.json({ 
      success: true, 
      licenses: licensesWithCooldown 
    });
  } catch (err) {
    console.error('Get licenses error:', err);
    res.status(500).json({ message: 'Failed to retrieve licenses' });
  }
});

app.post('/api/licenses/unbind', authenticateToken, async (req, res) => {
  try {
    const { license_key } = req.body;

    if (!license_key) {
      return res.status(400).json({ error: 'License key required' });
    }

    const licenseResult = await pool.query(
      'SELECT * FROM licenses WHERE license_key = $1 AND user_id = $2',
      [license_key.toUpperCase(), req.userId]
    );

    if (licenseResult.rows.length === 0) {
      return res.status(404).json({ error: 'License not found' });
    }

    const license = licenseResult.rows[0];

    if (!license.account_number) {
      return res.status(400).json({ error: 'License is not bound to any account' });
    }

    const cooldownResult = await pool.query(
      'SELECT next_allowed_unbind FROM cooldowns WHERE license_key = $1',
      [license_key.toUpperCase()]
    );

    if (cooldownResult.rows.length > 0) {
      const nextAllowed = new Date(cooldownResult.rows[0].next_allowed_unbind);
      if (nextAllowed > new Date()) {
        return res.status(429).json({ 
          message: 'Cooldown active. Please wait before unbinding again.',
          next_allowed: nextAllowed
        });
      }
    }

    await pool.query(
      `UPDATE licenses 
       SET platform = NULL, account_number = NULL, broker = NULL, bound_at = NULL
       WHERE license_key = $1`,
      [license_key.toUpperCase()]
    );

    // Set cooldown
const nextAllowedDate = new Date();
nextAllowedDate.setMinutes(nextAllowedDate.getMinutes() + UNBIND_COOLDOWN_MINUTES);

    await pool.query(
      `INSERT INTO cooldowns (license_key, last_unbind, next_allowed_unbind)
       VALUES ($1, CURRENT_TIMESTAMP, $2)
       ON CONFLICT (license_key) 
       DO UPDATE SET last_unbind = CURRENT_TIMESTAMP, next_allowed_unbind = $2`,
      [license_key.toUpperCase(), nextAllowedDate]
    );

    await pool.query(
      `INSERT INTO activations (license_key, platform, account_number, action, ip_address)
       VALUES ($1, $2, $3, 'unbind', $4)`,
      [license_key.toUpperCase(), license.platform, license.account_number, req.ip]
    );

    res.json({ 
      success: true, 
      message: 'License unbound successfully',
      next_allowed_unbind: nextAllowedDate
    });
  } catch (err) {
    console.error('Unbind error:', err);
    res.status(500).json({ error: 'Failed to unbind license' });
  }
});

app.get('/activation-history/:license_key', authenticateToken, async (req, res) => {
  try {
    const { license_key } = req.params;

    const licenseResult = await pool.query(
      'SELECT * FROM licenses WHERE license_key = $1 AND user_id = $2',
      [license_key.toUpperCase(), req.userId]
    );

    if (licenseResult.rows.length === 0) {
      return res.status(404).json({ error: 'License not found' });
    }

    const history = await pool.query(
      `SELECT platform, account_number, action, timestamp, ip_address
       FROM activations 
       WHERE license_key = $1 
       ORDER BY timestamp DESC 
       LIMIT 50`,
      [license_key.toUpperCase()]
    );

    res.json({ 
      success: true, 
      history: history.rows 
    });
  } catch (err) {
    console.error('History error:', err);
    res.status(500).json({ error: 'Failed to retrieve history' });
  }
});

app.post('/webhook/order-paid', async (req, res) => {
  try {
    const { order_number, email, line_items } = req.body;

    let userId;
    const userResult = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (userResult.rows.length > 0) {
      userId = userResult.rows[0].id;
    } else {
      const tempPassword = crypto.randomBytes(16).toString('hex');
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      
      const newUser = await pool.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
        [email.toLowerCase(), passwordHash]
      );
      userId = newUser.rows[0].id;
    }

    const generatedLicenses = [];
    
    for (const item of line_items) {
      if (item.title.includes('EA') || item.sku.includes('EA')) {
        for (let i = 0; i < item.quantity; i++) {
          const licenseKey = generateLicenseKey();
          
          const expiresAt = new Date();
          expiresAt.setFullYear(expiresAt.getFullYear() + 1);

          await pool.query(
            `INSERT INTO licenses (license_key, user_id, expires_at, purchase_order_id)
             VALUES ($1, $2, $3, $4)`,
            [licenseKey, userId, expiresAt, order_number]
          );

          generatedLicenses.push(licenseKey);
        }
      }
    }

    res.json({ 
      success: true, 
      licenses: generatedLicenses 
    });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

app.post('/admin/create-license', async (req, res) => {
  try {
    const { email, expires_in_days } = req.body;

    let userId;
    const userResult = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (userResult.rows.length > 0) {
      userId = userResult.rows[0].id;
    } else {
      return res.status(404).json({ error: 'User not found' });
    }

    const licenseKey = generateLicenseKey();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (expires_in_days || 365));

    await pool.query(
      `INSERT INTO licenses (license_key, user_id, expires_at)
       VALUES ($1, $2, $3)`,
      [licenseKey, userId, expiresAt]
    );

    res.json({ 
      success: true, 
      license_key: licenseKey,
      expires_at: expiresAt
    });
  } catch (err) {
    console.error('Create license error:', err);
    res.status(500).json({ error: 'Failed to create license' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;

initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`License server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});