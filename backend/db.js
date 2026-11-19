const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const mysql = require('mysql2/promise');
module.exports = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'weather_hereglegch',
    waitForConnections: true,
    connectionLimit: 10
});
