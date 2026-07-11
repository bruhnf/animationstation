// End-to-end proof that a visitor can reach the Sign Up / Log In pages from the
// feed and actually create an account and sign in.
//
// The bug this guards: the feed mints an anonymous guest session (POST
// /auth/guest) into the same localStorage keys a real login uses. login.html and
// signup.html gated on "is there a token?", saw the guest's, and bounced the
// visitor straight back to the feed — the page flashed, then vanished.
//
// Everything here is real: real backend, real Postgres, real browser, real
// clicks. Only the email inbox is bypassed — the verification token is read from
// the database, standing in for the user clicking the link in their email.
//
// Prereqs: backend on :3000 with docker compose postgres/redis (see README.md).
import { chromium } from 'playwright';
import { startSite } from './siteServer.mjs';
import { queryOne } from './db.mjs';

const PASSWORD = 'TestPass1!'; // satisfies signupSchema: 8+, upper, digit, special

const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const session = (page) =>
  page.evaluate(() => ({
    token: localStorage.getItem('accessToken'),
    user: JSON.parse(localStorage.getItem('user') || 'null'),
  }));

export async function run() {
  // No "+tag": normalizeEmail() strips subaddressing for every provider, so
  // e2e+1@… and e2e+2@… collapse to one inbox and the second signup is
  // (correctly) rejected as a duplicate. Vary the local part itself.
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const site = await startSite();
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    // 1. Land on the feed as a brand-new visitor and let it mint a guest.
    await page.goto(`${site.url}/`);
    await page.waitForFunction(() => !!localStorage.getItem('accessToken'), null, { timeout: 15000 });
    const guest = await session(page);
    check('feed mints a guest session', guest.user?.isGuest === true, `username=${guest.user?.username}`);
    check('banner offers Sign Up + Log In to the guest', await page.locator('#bannerRight a.banner-cta').isVisible());

    // 1b. The account page is the mirror image: a guest holds a token but owns
    //     no account, so it must send them to Log In rather than render.
    await page.goto(`${site.url}/account.html`);
    await page.waitForURL('**/login.html', { timeout: 10000 }).catch(() => {});
    check('guest is bounced off the account page', new URL(page.url()).pathname === '/login.html', page.url());
    await page.goto(`${site.url}/`); // back to the feed; the guest session is reused, not re-minted
    await page.waitForSelector('#bannerRight a.banner-cta', { timeout: 10000 });

    // 2. Click Sign Up. The regression was a redirect back to '/' moments later,
    //    so land, then wait and confirm we are still on the signup page.
    await page.click('#bannerRight a.banner-cta');
    await page.waitForURL('**/signup.html', { timeout: 10000 });
    await page.waitForTimeout(1500); // let any stray redirect fire
    check('Sign Up page stays open (no bounce to feed)', new URL(page.url()).pathname === '/signup.html', page.url());
    check('signup form is usable', await page.locator('#signupForm').isVisible());

    // 3. Create the account for real.
    await page.fill('#email', email);
    await page.fill('#password', PASSWORD);
    await page.fill('#confirmPassword', PASSWORD);
    await page.click('#submitBtn');
    await page.waitForSelector('#successMsg.visible', { timeout: 15000 });
    const successText = await page.textContent('#successMsg');
    check('signup reports success', /Account created/i.test(successText), successText.trim().slice(0, 60));

    // 4. The guest row should have been upgraded in place, not orphaned.
    const row = await queryOne(
      `select id, "isGuest", verified, username, "verifyToken" from users where email='${email}'`,
      ['id', 'isGuest', 'verified', 'username', 'verifyToken'],
    );
    check('account exists in the database', !!row, row?.id);
    check('signup claimed the guest row (same user id)', row?.id === guest.user?.id, `guest=${guest.user?.id} account=${row?.id}`);
    check('account is no longer a guest', row?.isGuest === 'f');
    check('account starts unverified', row?.verified === 'f');
    const stale = await session(page);
    check('dead guest session cleared from the browser', !stale.token);

    // 5. Log in before verifying: must be refused, with the resend link offered.
    await page.goto(`${site.url}/login.html`);
    await page.waitForTimeout(1000);
    check('Log In page stays open for a signed-out visitor', new URL(page.url()).pathname === '/login.html');
    await page.fill('#email', email);
    await page.fill('#password', PASSWORD);
    await page.click('#submitBtn');
    await page.waitForSelector('#errorMsg.visible', { timeout: 10000 });
    const errText = await page.textContent('#errorMsg');
    check('unverified login is refused with a human message', /verify your email/i.test(errText), errText.trim().slice(0, 60));
    check('resend-verification link offered', await page.locator('#errorMsg a').isVisible());

    // 6. Click the verification link (as the emailed link would).
    const verify = await page.request.get(`${site.url}/api/auth/verify/${row.verifyToken}`, { maxRedirects: 0 });
    check('verification link accepted', verify.status() === 302 || verify.ok(), `status=${verify.status()}`);

    // 7. Now log in for real, from the Log In button on the feed.
    await page.goto(`${site.url}/`);
    await page.waitForFunction(() => !!localStorage.getItem('accessToken'), null, { timeout: 15000 });
    await page.click('#bannerRight a.banner-ghost');
    await page.waitForURL('**/login.html', { timeout: 10000 });
    await page.waitForTimeout(1500);
    check('Log In page stays open while a guest session exists', new URL(page.url()).pathname === '/login.html', page.url());

    await page.fill('#email', email);
    await page.fill('#password', PASSWORD);
    await page.click('#submitBtn');
    await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 });

    const loggedIn = await session(page);
    check('logged in as a real (non-guest) user', !!loggedIn.token && !loggedIn.user?.isGuest, `username=${loggedIn.user?.username}`);
    check('logged-in user is the claimed account', loggedIn.user?.id === row.id);

    // The old text greeting ("Hi, {name}") was replaced by an avatar/initial
    // badge linking to /account.html, plus a credits/tier pill linking to /buy.html.
    await page.waitForSelector('#bannerRight .banner-avatar-link', { timeout: 10000 });
    const avatarTitle = await page.getAttribute('#bannerRight .banner-avatar-link', 'title');
    check('feed banner shows an account avatar instead of a text greeting', avatarTitle === 'My Account', avatarTitle);
    check('feed banner shows a credits pill', await page.locator('#bannerRight a.credits-pill').isVisible());
    check('feed banner offers Log out', await page.locator('#bannerRight button.banner-ghost').isVisible());

    // 8. A signed-in user visiting /login.html *should* bounce home.
    await page.goto(`${site.url}/login.html`);
    await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 10000 });
    check('signed-in user is redirected away from Log In', new URL(page.url()).pathname === '/');
  } finally {
    await browser.close();
    await site.close();
  }

  return checks;
}
