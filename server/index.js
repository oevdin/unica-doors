const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const contractorRoutes = require('./routes/contractors');
const orderRoutes = require('./routes/orders');
const catalogRoutes = require('./routes/catalog');
const salesRoutes = require('./routes/sales');
const settingsRoutes = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/contractors', contractorRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api', catalogRoutes);

// when DATA_DIR is set (persistent disk on hosting), product photos live
// outside public/ — serve them explicitly before the general static handler
if (process.env.DATA_DIR) {
  app.use('/uploads/products', express.static(catalogRoutes.UPLOAD_DIR));
}

app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback — anything not /api/* returns the app shell
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`UNICA server running on http://localhost:${PORT}`);
});
