let csrfToken;
// Page token survives refresh within this tab; never store Google credentials.
let pageToken = sessionStorage.getItem('weather.pageToken');
const authPanel = document.querySelector('.auth-panel');
const weatherPanel = document.querySelector('.weather-app');
const accountBar = document.querySelector('.account-bar');
const sessionMessage = document.getElementById('session-message');
function showUser(user) {
    weatherPanel.hidden = !user;
    accountBar.hidden = !user;
    authPanel.hidden = !!user;
    document.getElementById('signed-in-user').textContent = user ? `Signed in as ${user.first_name} ${user.last_name}` : '';
}
async function refreshCsrf() {
    const response = await fetch('/api/csrf', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('Cannot initialize session');
    csrfToken = (await response.json()).csrfToken;
}
async function restoreSession() {
    if (!pageToken) { showUser(null); sessionMessage.textContent = ''; return; }
    try {
        await refreshCsrf();
        const response = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Page-Token': pageToken } });
        if (response.status === 401) { pageToken = undefined; sessionStorage.removeItem('weather.pageToken'); showUser(null); sessionMessage.textContent = ''; return; }
        if (!response.ok) throw new Error('Session verification failed');
        showUser((await response.json()).user);
        sessionMessage.textContent = '';
    } catch { showUser(null); sessionMessage.textContent = 'Cannot verify session. Check the server and refresh.'; }
}
for (const [id, endpoint] of [['registerForm', 'register'], ['loginForm', 'login']]) {
    const form = document.getElementById(id);
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const message = form.querySelector('.auth-message');
        const button = form.querySelector('button');
        const fields = Object.fromEntries(new FormData(form));
        if (new TextEncoder().encode(fields.password).length > 72) { message.textContent = 'Password must not exceed 72 UTF-8 bytes.'; return; }
        button.disabled = true;
        message.textContent = 'Please wait…';
        try {
            if (!csrfToken) await refreshCsrf();
            const response = await fetch(`/api/${endpoint}`, {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify(fields)
            });
            const result = await response.json();
            message.textContent = result.message || 'Request failed';
            if (response.status === 403) { await refreshCsrf(); message.textContent = 'Session refreshed. Please submit again.'; }
            if (response.ok) {
                form.reset();
                if (endpoint === 'login') { await completeLogin(result); }
                else {
                    switchForm('login');
                    document.getElementById('loginEmail').value = fields.email.trim();
                    document.querySelector('#loginForm .auth-message').textContent = 'Registration successful. Please log in.';
                }
            }
        } catch { message.textContent = 'Cannot connect. Check the server and try again.'; }
        finally { button.disabled = false; }
    });
}
function switchForm(mode) {
    document.getElementById('registerForm').hidden = mode !== 'register';
    document.getElementById('loginForm').hidden = mode !== 'login';
    document.getElementById(mode === 'register' ? 'firstName' : 'loginEmail').focus();
}
document.getElementById('show-register').addEventListener('click', event => {
    event.preventDefault(); switchForm('register');
});
document.getElementById('show-login').addEventListener('click', event => {
    event.preventDefault(); switchForm('login');
});
async function completeLogin(result) {
    csrfToken = result.csrfToken;
    pageToken = result.pageToken;
    sessionStorage.setItem('weather.pageToken', pageToken);
    await restoreSession();
}
const googleMessage = document.getElementById('google-message');
let googleBusy = false;
async function googleLogin(result) {
    if (googleBusy) return;
    googleBusy = true;
    googleMessage.textContent = 'Signing in with Google...';
    try {
        const response = await fetch('/api/auth/google', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            body: JSON.stringify({ credential: result.credential })
        });
        const data = await response.json();
        if (!response.ok) { if (response.status === 403) await initializeGoogle(); googleMessage.textContent = data.message || 'Google login failed'; return; }
        await completeLogin(data);
        googleMessage.textContent = '';
    } catch { googleMessage.textContent = 'Google login unavailable. Try again or use email/password.'; }
    finally { googleBusy = false; }
}
async function initializeGoogle() {
    try {
        await refreshCsrf();
        const response = await fetch('/api/auth/config', { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw new Error('Configuration unavailable');
        const config = await response.json();
        if (!config.googleClientId) { googleMessage.textContent = 'Google Sign-In is not configured. Email login is available.'; return; }
        if (!window.google?.accounts?.id) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://accounts.google.com/gsi/client';
                script.async = true; script.onload = resolve; script.onerror = reject;
                document.head.appendChild(script);
            });
        }
        window.google.accounts.id.initialize({ client_id: config.googleClientId, callback: googleLogin,
            nonce: csrfToken, auto_select: false });
        window.google.accounts.id.renderButton(document.getElementById('google-button'), {
            theme: 'outline', size: 'large', text: 'continue_with', width: 300
        });
    } catch { googleMessage.textContent = 'Google Sign-In could not load. Email login is available.'; }
}
document.getElementById('logout-button').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
        await refreshCsrf();
        const response = await fetch('/api/logout', { method: 'POST', credentials: 'same-origin',
            headers: { 'X-CSRF-Token': csrfToken, 'X-Page-Token': pageToken } });
        if (!response.ok && response.status !== 401) throw new Error('Logout failed');
        pageToken = undefined;
        sessionStorage.removeItem('weather.pageToken');
        csrfToken = undefined;
        window.google?.accounts?.id?.disableAutoSelect();
        showUser(null); switchForm('login');
        sessionMessage.textContent = 'Logged out.';
        await initializeGoogle();
    } catch { sessionMessage.textContent = 'Could not confirm logout. Please try again.'; }
    finally { button.disabled = false; }
});
// Do not log out on pagehide: it fires during refresh too.
window.addEventListener('pageshow', restoreSession);
window.addEventListener('focus', restoreSession);
initializeGoogle();
