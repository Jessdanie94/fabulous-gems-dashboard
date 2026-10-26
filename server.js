require('dotenv').config();
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/api', require('./src/routes'));

import('./src/workers/index.js').then(({ startWorkers, handleStatusRequest }) => {
  app.use((req, res, next) => (handleStatusRequest(req, res) ? undefined : next()));
  startWorkers();
}).catch((error) => console.error('Failed to start background workers:', error.message));

app.listen(PORT, () => {
  console.log(`Fabulous Gems server running on port ${PORT}`);
});
