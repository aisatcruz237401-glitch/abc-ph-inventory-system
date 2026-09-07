console.log('!!! AUTH CONTROLLER LOADED !!!');

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { supabase, isSupabaseEnabled } = require('../config/supabase');

const fallbackAdmin = {
  username: 'admin',
  passwordHash: '$2a$10$f53EjA3S5dkmry.AQhteMOKKUHk86UAZdyLo.1GbPVc2cEy7QzvTu',
  role: 'admin',
  branch: 'Main',
};

function buildToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      branch: user.branch || user.assigned_branch || user.branch_name || 'Main',
    },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
}

exports.login = async (req, res) => {
  const { username, password } = req.body;

  console.log('=== LOGIN DEBUG ===');
  console.log('Username received:', JSON.stringify(username));
  console.log('Password received:', password ? '[provided]' : '[missing]');
  console.log('LOGIN ATTEMPT:', {
  username,
  passwordProvided: !!password
});

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  if (process.env.DEV_AUTH === 'true') {
    try {
      const validDev = await bcrypt.compare(password, fallbackAdmin.passwordHash);
      if (username === fallbackAdmin.username && validDev) {
        const token = buildToken({ id: 0, username: fallbackAdmin.username, role: fallbackAdmin.role, branch: fallbackAdmin.branch });
        return res.json({ token, user: { id: 0, username: fallbackAdmin.username, role: fallbackAdmin.role, branch: fallbackAdmin.branch } });
      }
    } catch (err) {
      console.error('DEV auth error', err);
    }
  }

  try {
    if (isSupabaseEnabled && supabase) {
      const byUsername = await supabase.from('users').select('*').eq('username', username).limit(1);
      console.log('Supabase lookup:', {
  error: byUsername.error,
  count: byUsername.data?.length,
  username: byUsername.data?.[0]?.username
});
      console.log('SUPABASE USER LOOKUP:', {
  username,
  error: byUsername.error,
  usersFound: byUsername.data?.length || 0
});
      if (!byUsername.error && byUsername.data && byUsername.data.length) {
        const user = byUsername.data[0];
        const passwordHash = user.password_hash || user.password || '';
        const valid = await bcrypt.compare(password, passwordHash);
        console.log('Password validation:', {
  userFound: !!user,
  passwordHashExists: !!passwordHash,
  valid
});
        console.log('PASSWORD CHECK:', {
  username: user.username,
  passwordHashExists: !!passwordHash,
  valid
});
        if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

        const token = buildToken(user);
        return res.json({
          token,
          user: {
            id: user.id,
            username: user.username,
            full_name: user.full_name || user.username,
            email: user.email || null,
            role: user.role,
            branch: user.branch || user.assigned_branch || user.branch_name || 'Main',
          },
        });
      }

      if (byUsername.error && !['42703', 'PGRST205'].includes(byUsername.error.code)) {
        throw byUsername.error;
      }

      try {
        const byEmail = await supabase.from('users').select('*').eq('email', username).limit(1);
        if (!byEmail.error && byEmail.data && byEmail.data.length) {
          const user = byEmail.data[0];
          const passwordHash = user.password_hash || user.password || '';
          const valid = await bcrypt.compare(password, passwordHash);
          if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

          const token = buildToken(user);
          return res.json({
            token,
            user: {
              id: user.id,
              username: user.username,
              full_name: user.full_name || user.username,
              email: user.email || null,
              role: user.role,
              branch: user.branch || user.assigned_branch || user.branch_name || 'Main',
            },
          });
        }
      } catch (emailLookupError) {
        if (!['42703', 'PGRST205'].includes(emailLookupError?.code)) {
          throw emailLookupError;
        }
      }

      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!pool) return res.status(500).json({ message: 'Database is not configured for this environment' });

    const [rows] = await pool.query('SELECT * FROM users WHERE username = ? OR email = ?', [username, username]);
    if (!rows.length) return res.status(401).json({ message: 'Invalid credentials' });

    const user = rows[0];
    const passwordHash = user.password || user.password_hash || '';
    const valid = await bcrypt.compare(password, passwordHash);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

    const token = buildToken(user);
    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name || user.username,
        email: user.email,
        role: user.role,
        branch: user.branch || user.assigned_branch,
      },
    });
  } catch (error) {
    console.error('Login error:', error);

    const connectionFailed =
      error?.code === 'ECONNREFUSED' ||
      error?.errors?.some((inner) => inner?.code === 'ECONNREFUSED') ||
      (typeof error?.message === 'string' && error.message.includes('ECONNREFUSED')) ||
      error?.fatal === true;

    if (connectionFailed) {
      const valid = await bcrypt.compare(password, fallbackAdmin.passwordHash);
      if (username === fallbackAdmin.username && valid) {
        const token = buildToken({ id: 0, username: fallbackAdmin.username, role: fallbackAdmin.role, branch: fallbackAdmin.branch });
        return res.json({ token, user: { id: 0, username: fallbackAdmin.username, role: fallbackAdmin.role, branch: fallbackAdmin.branch } });
      }
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    return res.status(500).json({ message: 'Login error', error: error.message || 'Internal server error' });
  }
};
