const express = require('express');
const path = require('path');
require('./seed');

const app = express();
app.use(express.json({ limit: '2mb' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/cash', require('./routes/cash'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/demo', require('./routes/demo'));
const catalog = require('./routes/catalog');
app.use('/api', catalog);
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

app.use('/uploads', express.static(catalog.UPLOAD_DIR, { maxAge: '30d' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: 0 }));
app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`UNICA работает: http://localhost:${PORT}`));
