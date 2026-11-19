# Weather App — Google Integration & Final Review

ChatGPT рүү дамжуулах тайлан. 2026-11-20.

## 1. Хийсэн боломжууд

- Одоо байсан Weather App загвар, Open-Meteo хайлт/background, bcrypt registration болон password login-ийг хадгалсан.
- Google Identity Services-ийн албан ёсны Continue with Google button нэмсэн. Public client ID-г backend config endpoint-оос авна; credential-ийг CSRF болон same-origin cookie-тэй /api/auth/google руу явуулна.
- google-auth-library-аар signature/issuer/audience/expiry шалгана. Session CSRF token-той таарах Google nonce, verified email болон sub claim шаарддаг.
- Хэрэглэгчийг google_sub-аар танина. Ижил email-тай account-ыг автоматаар холбохгүй; 409 conflict харуулна. Давтан Google login нь өмнөх user mapping-ийг ашиглана.
- Google-only хэрэглэгчид санамсаргүй, үл мэдэгдэх password-ийн bcrypt hash үүсгэхийн зэрэгцээ mapped Google хэрэглэгчийн password login-ийг тусад нь хориглосон.
- User/identity үүсгэх transaction, rollback, duplicate/deadlock race retry болон connection release хийсэн. Failed identity insert нь orphan user үлдээхгүй.
- Хоёр login нэг shared session helper ашигладаг: session ID regeneration, шинэ CSRF/page tokens, 8 цагийн absolute auth expiry, MySQL session save амжилттай болсны дараах success response.
- Login/Register тусдаа харагдацтай; registration дараа Login руу буцна. Google/password login хоёулаа /api/me-ээр баталгаажаад ижил Weather UI харуулна.
- Хавсаргасан хамгийн сүүлийн шаардлагын дагуу Logout товчийг сэргээж, refresh хийхэд sessionStorage дахь application page token-оор /api/me дуудан нэвтрэлтийг сэргээнэ. Raw Google token/password browser storage-д хадгалахгүй.
- Logout нь MySQL session устгах, cookie clear, page token clear, Google automatic account selection disable хийх урсгалтай.
- Helmet security headers/CSP, Google popup-д тохирох COOP, login/register/google endpoint-үүдэд 30 requests/IP/15min rate limit нэмсэн.
- Хуучин login.html/login.js-ийн CSRF-гүй, localhost hardcoded login урсгалыг unified UI руу redirect хийсэн.

## 2. Өөрчилсөн файлууд

- backend/server.js: Google route verification, shared session creation, Google-only password restriction, public client config, security headers/rate limiting, legacy login redirect.
- backend/google-auth.js: transaction-based Google identity lookup/creation, conflicts, rollback, race retries.
- backend/package.json, package-lock.json: helmet, express-rate-limit dependencies; existing session/mysql2 override retained.
- backend/migrations/001_google_identities.sql: additive mapping migration.
- hereglegch.sql: new setup mapping definition uses case-sensitive Google sub key.
- backend/.env.example: GOOGLE_CLIENT_ID safe placeholder. Existing .env secrets were not printed or replaced.
- frontend/index.html: Google button placeholder and Logout control; existing forms/weather design retained.
- frontend/register.js: GIS callback/config/nonce, shared login completion, refresh restoration, logout.
- frontend/login.html, login.js: retire duplicate insecure login handler via redirect.
- frontend/style.css: small scoped Google button styles.
- backend/test/google.test.js: Google/security/session/transaction tests.
- backend/test/frontend.test.js: frontend mocked-DOM integration test.
- README.md and this report: setup, Google origins, security/deployment instructions.

## 3. Өгөгдлийн сан

Local database холбогдсон. SQL файлд mapping definition байсан боловч бодит MySQL-д google_identities хүснэгт байгаагүй. Additive migration ажиллуулж үүсгэсэн:

- google_sub VARCHAR(255), ASCII binary collation, PRIMARY KEY.
- user_id INT, UNIQUE, users(id) FOREIGN KEY, ON DELETE CASCADE.

users table schema болон existing user records өөрчлөгдөөгүй. Database DROP/recreate хийгээгүй. CREATE TABLE IF NOT EXISTS migration нь existing schema-г автоматаар alter хийхгүй. Sessions existing MySQL session store-оор хадгалагдана.

## 4. Шалгалт ба бодит үр дүн

`npm.cmd test --prefix backend`: **8 PASS**, 0 FAIL.

- Password register/login regression: bcrypt, validation, duplicate email/race, generic errors, CSRF, session fixation prevention, /api/me, logout cookie replay.
- Google route fixtures: success, missing/wrong-type tokens, forged verifier rejection, wrong audience/issuer, expired token, missing verified email/sub, wrong nonce, account conflict, repeated mapping, rollback/database failure.
- Google-only account password login denial, even when a test hash matches a known password.
- Google session save failure returns error, not authenticated success.
- Official google-auth-library: locally RSA-signed token accepted; forged signature, expired token, wrong issuer/audience rejected. Public-key retrieval is replaced with a local fixture; this is not a real Google account sign-in test.
- Transaction duplicate retry/rollback/connection release tests use a mocked database, not live concurrent MySQL registrations.
- Rate limit returns 429; CSP and nosniff headers checked.
- Frontend mocked-DOM test: register-to-login flow, Google callback request CSRF, shared dashboard, refresh restoration model, logout clearing token. Not a browser test.
- Local MySQL: connectivity PASS; migration applied; both mapping unique indexes checked. Real MySQL store + Express smoke check: config present, CSRF session/cookie creation, malformed Google token 401. Existing users unchanged.
- JavaScript syntax and unique HTML ID checks passed. Configured secret values were scanned without printing them; none found in source.
- Dependency installation audit: 0 vulnerabilities.

## 5. Гараар хийх үлдсэн алхам

1. Google Cloud OAuth Web client Authorized JavaScript origins: http://localhost:3000. Хэрэв 127.0.0.1 ашиглавал тухайн origin-ийг тусад нь нэмнэ. Production-д HTTPS origin нэмнэ; path оруулахгүй.
2. Consent screen/audience/test users тохиргоог Google project-ийн шаардлагад нийцүүлнэ. Existing GOOGLE_CLIENT_ID configured эсэхийг шалгасан; console дээрх origin зөв эсэхийг энэ орчноос шалгаагүй.
3. Хуучин server process ажиллаж байвал restart хийнэ: npm.cmd start --prefix backend. Browser-оор http://localhost:3000 нээнэ.
4. Бодит Google account-аар шинэ login, давтан login, refresh, Logout, Google/password email conflict туршина. Browser privacy/extensions/network нь Google popup/script-ийг хааж байгаа эсэхийг шалгана.
5. Production Node/MySQL hosting, HTTPS, env secrets, controlled proxy, least-privilege DB account тохируулна. GitHub Pages дангаараа backend ажиллуулахгүй.

## 6. Хязгаарлалт / security

- Бодит browser Google authentication, HTTPS deployment болон бодит concurrent MySQL signup туршаагүй. Бүрэн production-ready гэж батлаагүй.
- Refresh persistence ба Logout нь хамгийн сүүлийн pasted specification-ийг дагасан; өмнөх no-logout/refresh-login requirement-ийг орлосон. sessionStorage нь restored tab/browser session-д хадгалагдаж болох тул хаагаад сэргээсэн browser заавал login шаардана гэж амлахгүй. Explicit Logout болон 8 цагийн auth expiry ашиглана.
- sessionStorage application page token нь JavaScript-д харагдана. Password/raw Google ID token хадгалахгүй; XSS хамгаалалт чухал.
- Limiter нь нэг process-ийн memory store ашиглана; олон server instance-д shared store шаардлагатай. TRUST_PROXY=1-ийг зөвхөн нэг trusted proxy-ийн ард тохируулна.
- Account linking deliberately unsupported. Existing email conflict-ийг эхний login method-оор шийднэ; email-ээр автоматаар холбохгүй.
- Email verification/recovery, monitoring/backups болон production operational checks үлдсэн.
- Git repo энэ checkout-д байхгүй тул tracked files/history audit хийх боломжгүй. .env/node_modules ignore байгаа; source дахь configured secrets scan тэнцсэн. Өөр газар өмнө нь secret commit хийсэн бол rotate/history cleanup тусад нь шаардлагатай.
- Git commit/push/publish/deploy хийгээгүй.

## Ажиллуулах

```powershell
npm.cmd ci --prefix backend
npm.cmd start --prefix backend
# Browser: http://localhost:3000
npm.cmd test --prefix backend
```

Тусдаа шинэ орчинд migrations/001_google_identities.sql-г existing database дээр ажиллуулж, .env.example-ийн дагуу secrets тохируулна. Existing .env-г дарж бичихгүй.

Баримт: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token , https://developers.google.com/identity/gsi/web/reference/js-reference , https://expressjs.com/en/resources/middleware/session/
