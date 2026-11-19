const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { randomBytes, timingSafeEqual } = require('crypto');
const { OAuth2Client } = require("google-auth-library");

const googleClient = new OAuth2Client();
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { googleUser } = require('./google-auth');

function createApp(db, options = {}) {
    const secret = options.secret || process.env.SESSION_SECRET;
    if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
    if (!options.store) throw new Error('A persistent session store must be configured');
    const app = express();
    app.disable('x-powered-by');
    app.use(helmet({
        crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
        strictTransportSecurity: process.env.NODE_ENV === 'production' ? undefined : false,
        contentSecurityPolicy: { directives: {
            scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
            connectSrc: ["'self'", 'https://accounts.google.com/gsi/', 'https://api.open-meteo.com', 'https://geocoding-api.open-meteo.com'],
            frameSrc: ['https://accounts.google.com/gsi/'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style'],
            upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
        } }
    }));
    const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: options.rateLimit || 30,
        standardHeaders: 'draft-8', legacyHeaders: false,
        message: { message: 'Too many attempts. Please try again later.' } });
    app.use(['/api/login', '/api/register', '/api/auth/google'], limiter);
    app.use(express.json({ limit: '16kb' }));
    const secure = process.env.NODE_ENV === 'production';
    if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
    const cookieOptions = { httpOnly: true, sameSite: 'lax', secure, path: '/' };
    app.use('/api', session({
        name: 'weather.sid', secret, store: options.store,
        resave: false, saveUninitialized: false,
        cookie: { ...cookieOptions }
    }));
    app.use('/api', (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            const token = req.get('X-CSRF-Token');
            const expected = req.session.csrfToken;
            if (!token || !expected || Buffer.byteLength(token) !== Buffer.byteLength(expected) ||
                !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
                return res.status(403).json({ message: 'Session verification failed. Refresh and try again.' });
            }
        }
        next();
    });
    app.get('/api/csrf', (req, res) => {
        req.session.csrfToken ||= randomBytes(32).toString('hex');
        res.json({ csrfToken: req.session.csrfToken });
    });
    const validPage = req => {
        const token = req.get('X-Page-Token');
        const expected = req.session.pageToken;
        return token && expected && Buffer.byteLength(token) === Buffer.byteLength(expected) &&
            timingSafeEqual(Buffer.from(token), Buffer.from(expected)) && req.session.authExpires > Date.now();
    };
    app.get('/api/me', async (req, res) => {
        if (!validPage(req) || !req.session.userId) return res.status(401).json({ message: 'Please log in' });
        try {
            const [users] = await db.query('SELECT id, first_name, last_name, email FROM users WHERE id = ?', [req.session.userId]);
            if (!users.length) {
                return req.session.destroy(() => { res.clearCookie('weather.sid', cookieOptions); res.status(401).json({ message: 'Please log in' }); });
            }
            const { id, first_name, last_name, email } = users[0];
            res.json({ authenticated: true, user: { id, first_name, last_name, email } });
        } catch { res.status(500).json({ message: 'Session verification unavailable' }); }
    });
    app.post('/api/logout', (req, res) => {
        if (!validPage(req)) return res.status(401).json({ message: 'Please log in' });
        req.session.destroy(error => {
            if (error) return res.status(500).json({ message: 'Logout failed. Try again.' });
            res.clearCookie('weather.sid', cookieOptions);
            res.json({ message: 'Logged out successfully' });
        });
    });



    const clientId = options.googleClientId || process.env.GOOGLE_CLIENT_ID;
    const verifier = options.googleVerifier || googleClient;
    async function authenticate(req, res, user, message) {
        await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
        req.session.userId = user.id;
        req.session.pageToken = randomBytes(32).toString('hex');
        req.session.authExpires = Date.now() + 8 * 60 * 60 * 1000;
        req.session.csrfToken = randomBytes(32).toString('hex');
        try {
            await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
        } catch (error) {
            await new Promise(resolve => req.session.destroy(() => resolve()));
            throw error;
        }
        res.json({ authenticated: true, message, csrfToken: req.session.csrfToken, pageToken: req.session.pageToken,
            user: { id: user.id, first_name: user.first_name, last_name: user.last_name, email: user.email } });
    }
    app.get('/api/auth/config', (req, res) => res.json({ googleClientId: clientId || null }));
    app.post('/api/auth/google', async (req, res) => {
        const credential = req.body?.credential;
        if (!clientId) return res.status(503).json({ message: 'Google Sign-In is not configured' });
        if (typeof credential !== 'string' || !credential.length || credential.length > 10000) {
            return res.status(400).json({ message: 'Invalid Google login request' });
        }
        let payload;
        try {
            const ticket = await verifier.verifyIdToken({ idToken: credential, audience: clientId });
            payload = ticket.getPayload();
            if (!payload || typeof payload.sub !== 'string' || !payload.sub.length || payload.sub.length > 255 ||
                !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss) || payload.aud !== clientId ||
                !Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now() || payload.email_verified !== true ||
                payload.nonce !== req.session.csrfToken || !validEmail(emailValue(payload.email))) {
                return res.status(401).json({ message: 'Google account verification failed' });
            }
        } catch { return res.status(401).json({ message: 'Google authentication failed' }); }
        try {
            const user = await googleUser(db, payload);
            await authenticate(req, res, user, 'Google login successful!');
        } catch (error) {
            res.status(error.status === 409 ? 409 : 500).json({ message: error.status === 409 ? error.message : 'Google login unavailable' });
        }
    });

    // Serve UI and API from one origin; no wildcard CORS is needed.
    app.use('/assets', express.static(path.join(__dirname, '../assets')));
    app.get('/login.html', (req, res) => res.redirect('/'));
    app.use(express.static(path.join(__dirname, '../frontend')));

    const emailValue = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
    const validEmail = value => value.length <= 100 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    const validPassword = value => typeof value === 'string' && value.length >= 8 && Buffer.byteLength(value, 'utf8') <= 72;

    app.post('/api/register', async (req, res) => {
        const { first_name, last_name, password } = req.body || {};
        const email = emailValue(req.body?.email);
        if (![first_name, last_name].every(v => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 100) || !validEmail(email) || !validPassword(password)) {
            return res.status(400).json({ message: 'Provide names (1–100 characters), a valid email, and a password of at least 8 characters and at most 72 UTF-8 bytes.' });
        }
        try {
            const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
            if (existing.length) return res.status(409).json({ message: 'Email already registered' });
            const hash = await bcrypt.hash(password, 12);
            await db.query('INSERT INTO users (first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?)', [first_name.trim(), last_name.trim(), email, hash]);
            return res.status(201).json({ message: 'User registered successfully! Please log in.' });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Email already registered' });
            // Never log SQL errors: they can include bound credentials and personal data.
            return res.status(500).json({ message: 'Registration unavailable. Please try again later.' });
        }
    });

    app.post('/api/login', async (req, res) => {
        const email = emailValue(req.body?.email);
        const password = req.body?.password;
        if (!validEmail(email) || typeof password !== 'string' || !password.length || Buffer.byteLength(password, 'utf8') > 72) {
            return res.status(400).json({ message: 'Provide a valid email and password (at most 72 UTF-8 bytes).' });
        }
        try {
            const [users] = await db.query('SELECT id, first_name, last_name, email, password_hash, EXISTS(SELECT 1 FROM google_identities g WHERE g.user_id = users.id) AS google_only FROM users WHERE email = ?', [email]);
            const user = users[0];
            if (!user || user.google_only || !await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ message: 'Invalid email or password' });
            await authenticate(req, res, user, 'Login successful!');
        } catch {
            return res.status(500).json({ message: 'Login unavailable. Please try again later.' });
        }
    });
    app.use('/api', (req, res) => res.status(404).json({ message: 'Endpoint not found' }));
    app.use((error, req, res, next) => {
        if (error.type === 'entity.too.large') return res.status(413).json({ message: 'Request is too large' });
        if (error.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid JSON body' });
        return res.status(500).json({ message: 'Server error' });
    });
    return app;
}
if (require.main === module) {
    const db = require('./db');
    const MySQLStore = require('express-mysql-session')(session);
    const store = new MySQLStore({ expiration: 8 * 60 * 60 * 1000 }, db);
    store.on('error', () => console.error('Session store unavailable'));
    store.onReady().then(() => {
        createApp(db, { store }).listen(process.env.PORT || 3000, () => console.log('Weather App server started'));
    }).catch(() => { console.error('Server startup failed; check database and session configuration'); process.exitCode = 1; store.close().finally(() => db.end()); });
}
module.exports = { createApp };
