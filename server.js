require('dotenv').config();
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/api', require('./src/routes'));

app.listen(PORT, () => {
  console.log(`Fabulous Gems server running on port ${PORT}`);
});
