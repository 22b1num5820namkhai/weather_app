const bcrypt = require('bcrypt');
const { randomBytes } = require('crypto');
const linkedSQL = `SELECT u.id, u.first_name, u.last_name, u.email FROM google_identities g JOIN users u ON u.id = g.user_id WHERE g.google_sub = ?`;
const conflict = () => Object.assign(new Error('An account with this email already exists. Use its original login method.'), { status: 409 });
async function googleUser(db, payload) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const connection = await db.getConnection();
        let active = false;
        let released = false;
        try {
            await connection.beginTransaction(); active = true;
            const [linked] = await connection.query(linkedSQL, [payload.sub]);
            let user = linked[0];
            if (!user) {
                const email = payload.email.trim().toLowerCase();
                const [existing] = await connection.query('SELECT id FROM users WHERE email = ?', [email]);
                if (existing.length) throw conflict();
                const first = (typeof payload.given_name === 'string' && payload.given_name.trim() || 'Google').slice(0, 100);
                const last = (typeof payload.family_name === 'string' && payload.family_name.trim() || 'User').slice(0, 100);
                const hash = await bcrypt.hash(randomBytes(32).toString('hex'), 12);
                const [result] = await connection.query('INSERT INTO users (first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?)', [first, last, email, hash]);
                await connection.query('INSERT INTO google_identities (google_sub, user_id) VALUES (?, ?)', [payload.sub, result.insertId]);
                user = { id: result.insertId, first_name: first, last_name: last, email };
            }
            await connection.commit(); active = false;
            return user;
        } catch (error) {
            if (active) await connection.rollback();
            if (['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) {
                connection.release(); released = true;
                // Re-read outside the rolled-back snapshot: another request may have won.
                const [linked] = await db.query(linkedSQL, [payload.sub]);
                if (linked.length) return linked[0];
                if (attempt < 2) continue;
                throw conflict();
            }
            throw error;
        } finally { if (!released) connection.release(); }
    }
}
module.exports = { googleUser };
