require('dotenv').config();
const express = require('express');
const sql = require('mssql');
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
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  server: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 1433,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
  options: {
    encrypt: true,
    trustServerCertificate: process.env.NODE_ENV !== 'production',
  },
};

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_SECRET is not set. Please configure it in the .env file.');
  process.exit(1);
}

// Connect to database
const poolPromise = new sql.ConnectionPool(dbConfig)
  .connect()
  .then((pool) => {
    console.log('Connected to SQL Server database');
    return pool;
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

    const pool = await poolPromise;
    const request = new sql.Request(pool);

    await request
      .input('action', sql.NVarChar, action)
      .input('targetId', sql.NVarChar, String(targetId))
      .input('targetType', sql.NVarChar, targetType)
      .input('comment', sql.NVarChar, comment || null)
      .query(
        'INSERT INTO logs (action, target_id, target_type, comment, created_at) ' +
        'VALUES (@action, @targetId, @targetType, @comment, GETDATE())'
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

    // Validate required fields
    if (!userid || !username || !password || !name) {
      return res.status(400).json({ message: 'User ID, username, password, name are required' });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    // Validate username length
    if (username.length < 3) {
      return res.status(400).json({ message: 'Username must be at least 3 characters long' });
    }

    // Check for existing user
    const pool = await poolPromise;
    const request = pool.request();
    const existingUser = await request
      .input('checkUsername', sql.VarChar, username)
      .input('checkUserid', sql.VarChar, userid)
      .query('SELECT userid, username FROM Users WHERE username = @checkUsername OR userid = @checkUserid');

    if (existingUser.recordset.length > 0) {
      const existing = existingUser.recordset[0];
      if (existing.username === username) {
        return res.status(409).json({ message: 'Username already exists' });
      }
      if (existing.userid === userid) {
        return res.status(409).json({ message: 'User ID already exists' });
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert user into database
    const insertRequest = pool.request();
    await insertRequest
      .input('userid', sql.VarChar, userid)
      .input('username', sql.VarChar, username)
      .input('password', sql.VarChar, hashedPassword)
      .input('name', sql.NVarChar, name)
      .input('role', sql.NVarChar, role)
      .input('division', sql.NVarChar, division)
      .query(
        'INSERT INTO Users (userid, username, password, name, role, division) ' +
        'VALUES (@userid, @username, @password, @name, @role, @division)'
      );

    // Log successful registration
    await logAction(
      'REGISTER',
      userid,
      'USER',
      `User ${username} (${userid}) registered successfully with role(s): ${role}`
    );

    // Send success response
    res.status(201).json({
      message: 'Registration successful',
      user: {
        userid,
        username,
        name,
        role,
        division
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    await logAction('REGISTER_ERROR', null, 'USER', `Error during registration: ${err.message}`);

    if (err.code === 'EREQUEST') {
      return res.status(400).json({ message: 'Database validation error' });
    }

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

    const pool = await poolPromise;
    const request = pool.request();

    const result = await request
      .input('username', sql.VarChar, username)
      .query('SELECT * FROM Users WHERE username = @username');

    if (result.recordset.length === 0) {
      await logAction('LOGIN_ATTEMPT', username, 'USER', `Failed login attempt for username: ${username} - User not found`);
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const user = result.recordset[0];

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      await logAction('LOGIN_ATTEMPT', username, 'USER', `Failed login attempt for username: ${username} - Invalid password`);
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { 
        userid: user.userid, 
        username: user.username,
        division: user.division, 
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    await logAction('LOGIN_SUCCESS', user.userid, 'USER', `User ${username} (${user.userid}) logged in successfully`);

    res.json({
      token,
      user: { 
        userid: user.userid, 
        username: user.username,
        name: user.name, 
        role: user.role,
      },
      message: 'Login successful'
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

    const pool = await poolPromise;
    const request = pool.request();

    const result = await request
      .input('userid', sql.VarChar, userid)
      .query('SELECT * FROM Users WHERE userid = @userid');

    if (result.recordset.length === 0) {
      await logAction('LOGIN_ATTEMPT', userid, 'USER', `Failed login for userid: ${userid}`);
      return res.status(401).json({ message: 'User not found' });
    }

    const user = result.recordset[0];

    const token = jwt.sign(
      { userid: user.userid, role: user.role, name: user.name,},
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    await logAction('LOGIN_SUCCESS', userid, 'USER', `User ${userid} logged in successfully`);

    res.json({
      token,
      user: { userid: user.userid, name: user.name, role: user.role},
    });
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

    if (!cardId) {
      return res.status(400).json({ message: 'Card ID is required' });
    }

    const pool = await poolPromise;
    const request = pool.request();

    const result = await request
      .input('cardId', sql.VarChar, cardId)
      .query('SELECT userid, username, name, division, role, org FROM Users WHERE userid = @cardId');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'User not found for this Card ID' });
    }

    const user = result.recordset[0];
    res.json({
      userid: user.userid,
      username: user.username,
      name: user.name,
      division: user.division,
      role: user.role,
      org: user.org,
    });
  } catch (err) {
    console.error('Error fetching user by Card ID:', err);
    res.status(500).json({ message: 'Failed to fetch user information' });
  }
});

// New endpoint: Update user details
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

    const pool = await poolPromise;
    const request = pool.request();

    // ตรวจสอบ username ซ้ำ (ยกเว้นตัวเอง)
    const existingUser = await request
      .input('checkUsername', sql.VarChar, username)
      .input('checkUserid', sql.VarChar, userid)
      .query('SELECT userid FROM Users WHERE username = @checkUsername AND userid != @checkUserid');

    if (existingUser.recordset.length > 0) {
      return res.status(409).json({ message: 'Username already exists' });
    }

    // เริ่มสร้าง query
    const updateFields = [];
    const now = new Date();
    const thaiTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);

    updateFields.push('username = @username');
    updateFields.push('division = @division');
    updateFields.push('name = @name');
    updateFields.push('role = @role');
    updateFields.push('updated_at = @updated_at');

    request.input('username', sql.VarChar, username);
    request.input('division', sql.NVarChar, division);
    request.input('name', sql.NVarChar, name);
    request.input('role', sql.NVarChar, role);
    request.input('updated_at', sql.DateTime, thaiTime);
    request.input('userid', sql.VarChar, userid);

    // อัปเดตรหัสผ่านถ้ามี
    if (password) {
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      updateFields.push('password = @password');
      request.input('password', sql.VarChar, hashedPassword);
    }

    const query = `
      UPDATE Users
      SET ${updateFields.join(', ')}
      WHERE userid = @userid;

      SELECT userid, username, division, name, role, created_at, updated_at
      FROM Users
      WHERE userid = @userid;
    `;

    const result = await request.query(query);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // ส่ง response กลับ
    return res.json({
      message: 'User updated successfully',
      user: result.recordset[0]  // ส่ง user กลับไป
    });

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

app.get('/api/profile', verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const request = pool.request();

    const result = await request
      .input('userid', sql.VarChar, req.user.userid)
      .query('SELECT userid, username, name, division, email, org, role FROM Users WHERE userid = @userid');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = result.recordset[0];
    res.json({
      userid: user.userid,
      username: user.username,
      name: user.name,
      division: user.division,
      email: user.email,
      org: user.org,
      role: user.role
    });
  } catch (err) {
    console.error('Error fetching user profile:', err);
    res.status(500).json({ message: 'Failed to fetch user profile' });
  }
});

app.post('/api/change-password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters long' });
    }

    const pool = await poolPromise;
    const request = pool.request();

    const userResult = await request
      .input('userid', sql.VarChar, req.user.userid)
      .query('SELECT password FROM Users WHERE userid = @userid');

    if (userResult.recordset.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userResult.recordset[0];

    const passwordMatch = await bcrypt.compare(currentPassword, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

    const updateRequest = pool.request();
    await updateRequest
      .input('userid', sql.VarChar, req.user.userid)
      .input('newPassword', sql.VarChar, hashedNewPassword)
      .query('UPDATE Users SET password = @newPassword WHERE userid = @userid');

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
  console.log('Serving React app for:', req.path);
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.get('/MECHATOOLINGPS', (req, res) => {
  console.log('Serving React app for root MECHATOOLINGPS');
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});