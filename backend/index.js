require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');
const SALT_ROUNDS = 10;

const app = express();
app.use(express.json());
app.use(cors());

// ========== STATIC FILE SERVING ==========
app.use('/MECHATOOLINGPS', express.static(path.join(__dirname, 'build')));
app.use('/MECHATOOLINGPS/static', express.static(path.join(__dirname, 'build/static')));

// Database configuration
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
});

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_SECRET is not set. Please configure it in the .env file.');
  process.exit(1);
}

// Verify DB connection at startup
pool.getConnection()
  .then((conn) => {
    console.log('Connected to MariaDB database');
    conn.release();
  })
  .catch((err) => {
    console.error('Database connection error:', err);
    process.exit(1);
  });

// Middleware to verify JWT and role
const verifyToken = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid token.' });
  }
};

const requireADMIN = (req, res, next) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ message: 'ADMIN role required' });
  }
  next();
};

const requireCommon = (req, res, next) => {
  if (!['ADMIN', 'Common', 'IQC'].includes(req.user.role)) {
    return res.status(403).json({ message: 'ADMIN or ISSUE or IQC role required' });
  }
  next();
};

// Log action to the database
const logAction = async (action, targetId, targetType, comment) => {
  try {
    if (!action || !targetType) {
      throw new Error('Action and targetType are required');
    }

    await pool.execute(
      'INSERT INTO logs (action, target_id, target_type, comment, created_at) VALUES (?, ?, ?, ?, NOW())',
      [action, String(targetId), targetType, comment || null]
    );

    return true;
  } catch (err) {
    console.error('Error logging action:', err.message);
    return false;
  }
};

// ========== API ROUTES ==========

// Register endpoint
app.post('/api/register', async (req, res) => {
  try {
    const { userid, username, password, name, role, division } = req.body;

    if (!userid || !username || !password || !name) {
      return res.status(400).json({ message: 'User ID, username, password, name are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    if (username.length < 3) {
      return res.status(400).json({ message: 'Username must be at least 3 characters long' });
    }

    const [existing] = await pool.execute(
      'SELECT userid, username FROM Users WHERE username = ? OR userid = ?',
      [username, userid]
    );

    if (existing.length > 0) {
      if (existing[0].username === username) {
        return res.status(409).json({ message: 'Username already exists' });
      }
      if (existing[0].userid === userid) {
        return res.status(409).json({ message: 'User ID already exists' });
      }
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    await pool.execute(
      'INSERT INTO Users (userid, username, password, name, role, division) VALUES (?, ?, ?, ?, ?, ?)',
      [userid, username, hashedPassword, name, role, division]
    );

    await logAction('REGISTER', userid, 'USER', `User ${username} (${userid}) registered successfully with role(s): ${role}`);

    res.status(201).json({
      message: 'Registration successful',
      user: { userid, username, name, role, division },
    });
  } catch (err) {
    console.error('Register error:', err);
    await logAction('REGISTER_ERROR', null, 'USER', `Error during registration: ${err.message}`);
    res.status(500).json({ message: 'Failed to register user' });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    const [rows] = await pool.execute('SELECT * FROM Users WHERE username = ?', [username]);

    if (rows.length === 0) {
      await logAction('LOGIN_ATTEMPT', username, 'USER', `Failed login attempt for username: ${username} - User not found`);
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const user = rows[0];

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      await logAction('LOGIN_ATTEMPT', username, 'USER', `Failed login attempt for username: ${username} - Invalid password`);
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { userid: user.userid, username: user.username, division: user.division, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    await logAction('LOGIN_SUCCESS', user.userid, 'USER', `User ${username} (${user.userid}) logged in successfully`);

    res.json({
      token,
      user: { userid: user.userid, username: user.username, name: user.name, role: user.role },
      message: 'Login successful',
    });
  } catch (err) {
    console.error('Login error:', err);
    await logAction('LOGIN_ERROR', null, 'USER', `Error during login: ${err.message}`);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Login RFID endpoint
app.post('/api/login_rfid', async (req, res) => {
  try {
    const { userid } = req.body;

    if (!userid) {
      return res.status(400).json({ message: 'User ID are required' });
    }

    const [rows] = await pool.execute('SELECT * FROM Users WHERE userid = ?', [userid]);

    if (rows.length === 0) {
      await logAction('LOGIN_ATTEMPT', userid, 'USER', `Failed login for userid: ${userid}`);
      return res.status(401).json({ message: 'User not found' });
    }

    const user = rows[0];

    const token = jwt.sign(
      { userid: user.userid, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    await logAction('LOGIN_SUCCESS', userid, 'USER', `User ${userid} logged in successfully`);

    res.json({ token, user: { userid: user.userid, name: user.name, role: user.role } });
  } catch (err) {
    console.error('Login error:', err);
    await logAction('LOGIN_ERROR', null, 'USER', `Error during login: ${err.message}`);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user by Card ID
app.get('/api/user/:cardId', verifyToken, async (req, res) => {
  try {
    const { cardId } = req.params;

    const [rows] = await pool.execute(
      'SELECT userid, username, name, division, role, org FROM Users WHERE userid = ?',
      [cardId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found for this Card ID' });
    }

    const user = rows[0];
    res.json({ userid: user.userid, username: user.username, name: user.name, division: user.division, role: user.role, org: user.org });
  } catch (err) {
    console.error('Error fetching user by Card ID:', err);
    res.status(500).json({ message: 'Failed to fetch user information' });
  }
});

// Update user details
app.patch('/api/user/:userid', verifyToken, requireADMIN, async (req, res) => {
  try {
    const { userid } = req.params;
    const { username, division, name, role, password } = req.body;

    if (!username || !name) {
      return res.status(400).json({ message: 'Username and name are required' });
    }

    if (username.length < 3) {
      return res.status(400).json({ message: 'Username must be at least 3 characters long' });
    }

    if (password && password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    const [existingRows] = await pool.execute(
      'SELECT userid FROM Users WHERE username = ? AND userid != ?',
      [username, userid]
    );

    if (existingRows.length > 0) {
      return res.status(409).json({ message: 'Username already exists' });
    }

    const updateFields = ['username = ?', 'division = ?', 'name = ?', 'role = ?', 'updated_at = NOW()'];
    const params = [username, division, name, role];

    if (password) {
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      updateFields.push('password = ?');
      params.push(hashedPassword);
    }

    params.push(userid);

    await pool.execute(
      `UPDATE Users SET ${updateFields.join(', ')} WHERE userid = ?`,
      params
    );

    const [rows] = await pool.execute(
      'SELECT userid, username, division, name, role, created_at, updated_at FROM Users WHERE userid = ?',
      [userid]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({ message: 'User updated successfully', user: rows[0] });
  } catch (err) {
    console.error('Error updating user:', err);
    await logAction('UPDATE_USER_ERROR', req.params.userid, 'USER', `Error updating user: ${err.message}`);
    return res.status(500).json({ message: 'Failed to update user' });
  }
});

// Log action endpoint
app.post('/api/log', verifyToken, async (req, res) => {
  try {
    const { action, targetId, targetType, comment } = req.body;

    const success = await logAction(action, targetId, targetType, comment);
    if (!success) {
      throw new Error('Failed to log action');
    }

    res.json({ message: 'Action logged successfully' });
  } catch (err) {
    console.error('Log endpoint error:', err.message);
    res.status(500).json({ message: 'Failed to log action' });
  }
});

// Get current user profile
app.get('/api/profile', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT userid, username, name, division, email, org, role FROM Users WHERE userid = ?',
      [req.user.userid]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = rows[0];
    res.json({ userid: user.userid, username: user.username, name: user.name, division: user.division, email: user.email, org: user.org, role: user.role });
  } catch (err) {
    console.error('Error fetching user profile:', err);
    res.status(500).json({ message: 'Failed to fetch user profile' });
  }
});

// Change password
app.post('/api/change-password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters long' });
    }

    const [rows] = await pool.execute('SELECT password FROM Users WHERE userid = ?', [req.user.userid]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const passwordMatch = await bcrypt.compare(currentPassword, rows[0].password);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await pool.execute('UPDATE Users SET password = ? WHERE userid = ?', [hashedNewPassword, req.user.userid]);

    await logAction('PASSWORD_CHANGE', req.user.userid, 'USER', `Password changed for user ${req.user.username}`);

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Error changing password:', err);
    await logAction('PASSWORD_CHANGE_ERROR', req.user.userid, 'USER', `Error changing password: ${err.message}`);
    res.status(500).json({ message: 'Failed to change password' });
  }
});

// ========== REACT ROUTER FALLBACK ==========
app.get('/MECHATOOLINGPS/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.get('/MECHATOOLINGPS', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
