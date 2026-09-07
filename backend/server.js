
const express = require('express');
const http = require('http');
const path = require('path');

const app = express();

const danteFrontendPath = path.join(__dirname, '..', 'frontend', 'dante-frontend');
const legacyFrontendPath = path.join(__dirname, '..', 'frontend');

console.log('Serving dante frontend from:', danteFrontendPath);
console.log('Serving legacy frontend from:', legacyFrontendPath);
const cors = require('cors');
const dotenv = require('dotenv');

const socketServer = require('./socket/socketServer');
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const receiveRoutes = require('./routes/receiveRoutes');
const consumeRoutes = require('./routes/consumeRoutes');
const reportRoutes = require('./routes/reportRoutes');
const transferRoutes = require('./routes/transferRoutes');
const branchRoutes = require('./routes/branchRoutes');
const deliverRoutes = require('./routes/deliverRoutes');
const intakeRoutes = require('./routes/intakeRoutes');
console.log('REGISTERING INTAKE ROUTES: /api/intake');

dotenv.config();

const server = http.createServer(app);
const io = socketServer(app, server);

const allowedOrigins = [
  process.env.FRONTEND_ORIGIN,
  'http://localhost:3000',
  'http://127.0.0.1:3000'
].filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

// Active frontend must be mounted before legacy assets so /pages/* and /js/* resolve to the dante app.
app.use(express.static(danteFrontendPath));
app.use(express.static(legacyFrontendPath));

// Inventory system frontend
app.use(
  '/legacy',
  express.static(
    path.join(
      __dirname,
      '..',
      'frontend',
      'stitch_vaxtrack_abc_admin_inventory_system',
      'stitch_vaxtrack_abc_admin_inventory_system',
      'frontend'
    )
  )
);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/receive', receiveRoutes);
app.use('/api/consume', consumeRoutes);
app.use('/api/deliver', deliverRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/transfers', transferRoutes);
app.use('/api/branches', branchRoutes);

console.log('REGISTERING INTAKE ROUTES: /api/intake');
app.use('/api/intake', intakeRoutes);

app.get('/api/intake-test', (req, res) => {
  res.json({
    success: true,
    message: 'Current server.js is running'
  });
});


// Main page
app.get('/', (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      '..',
      'frontend',
      'dante-frontend',
      'index.html'
    )
  );
});

// Error handler
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      message: 'Invalid JSON payload'
    });
  }

  console.error('Unhandled server error:', err);

  res.status(500).json({
    message: 'Server error',
    error: err.message
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});