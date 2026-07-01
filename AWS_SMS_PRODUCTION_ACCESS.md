# AWS SMS — Production Access Request (sandbox exit)

Draft content for the AWS Support case that moves the account out of the **SMS
sandbox** so the toll-free number can send to **any** verified-or-not US mobile
number (today, sandbox = verified destinations only).

**How to file:** AWS Console → **Support** → *Create case* → **Looking for service
limit increases?** → Service: **SMS (End User Messaging / Pinpoint SMS and Voice
v2)** → Quota: **SMS Production Access / Move account out of SMS sandbox**.
(Alternatively the "Service Quotas" → End User Messaging path, then a support
case for the sandbox-exit, since Basic support is console-only.)

Paste the fields below into the case description. Everything here is already true
of the live setup — keep it factual; the carrier/AWS reviewer will compare it to
the live opt-in page and Privacy Policy.

---

## Account / number facts

| Field | Value |
|---|---|
| AWS account ID | 165341015574 |
| Region | us-east-1 |
| Origination identity | Toll-free **+18337624449** (registration APPROVED, number ACTIVE) |
| Number type | Toll-free, **TRANSACTIONAL** |
| Configuration set | `evofaceflow-sms` (CloudWatch event logging → `/aws/sms-voice/evofaceflow`, 30-day retention) |
| Destination countries | **United States only** (E.164 `+1`, 10-digit) |
| Current status | SMS **sandbox** — requesting production access |

## Business

- **Company:** Bruhn Freeman (sole proprietorship), operating the **TryOn Mirror** mobile app.
- **Business address:** 2767 Route 44/55, Gardiner, NY 12525, USA.
- **Website:** https://tryon-mirror.ai
- **Contact email:** bruhn@tryon-mirror.ai
- **Product:** TryOn Mirror is an AI-powered virtual clothing try-on iOS app. Users create an account (email + password), upload body photos, and generate try-on images of themselves in clothing they photograph.

## Use case category

**Transactional / account-related messages only. No marketing or promotional
content.** Specifically:

1. **One-time passcodes (OTP)** — account verification and re-authentication codes.
2. **Security alerts** — notification of a new or suspicious sign-in (new device / unusual location), so the account owner can react to possible unauthorized access.
3. **Account notifications** — transactional status messages tied to actions the user took in the app (e.g., a requested process completed).

## How recipients opt in (consent)

Consent is **explicit and self-service**, captured before any message is sent:

- A dedicated web opt-in page collects the mobile number and an **unchecked-by-default consent checkbox**:
  - https://tryon-mirror.ai/sms.html (also served at the legacy https://evofaceflow.com/sms.html)
- The exact consent language presented and stored with every opt-in:
  > "I agree to receive recurring automated text messages (account notifications, security alerts, and one-time passcodes) from TryOn Mirror at the mobile number provided. Consent is not a condition of any purchase. Message frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help."
- Each opt-in is recorded server-side (`SmsOptIn` table) with the phone number, the verbatim consent text shown, the source, IP address, and a timestamp — providing an auditable consent record.
- **Consent is not a condition of purchase**, and the SMS program is disclosed in our Privacy Policy: https://tryon-mirror.ai/privacy.html (SMS program section — message types, frequency, opt-out, "message & data rates may apply", and a no-sharing-with-third-parties-for-marketing statement).

## Opt-out / HELP handling

- **STOP / UNSTOP / HELP** are handled automatically by AWS End User Messaging's
  built-in keyword responses for the US toll-free number.
- We additionally honor opt-outs in our own data model (`SmsOptIn.optedOutAt`), so a
  user who opts out is excluded from future sends.
- Every message includes "Reply STOP to opt out" guidance per the consent text.

## Sample messages

1. OTP:
   > TryOn Mirror: Your verification code is 123456. It expires in 10 minutes. Reply STOP to opt out, HELP for help.

2. Security alert:
   > TryOn Mirror security alert: a new sign-in to your account was detected near Gardiner, NY. If this wasn't you, reset your password at tryon-mirror.ai. Reply STOP to opt out.

3. Account notification:
   > TryOn Mirror: your request has finished processing — open the app to view the result. Reply STOP to opt out.

## Volume estimate

Low and transactional, scaling with active users. Initial expectation on the
order of **a few hundred messages per month** (well under ~1,000/month), driven by
sign-ins and verifications rather than broadcast sends. No bulk or campaign
traffic.

## Why production access is needed

In the sandbox, sends only reach **verified** destination numbers, which means
real users cannot receive their own verification codes or security alerts.
Production access is required to deliver these transactional messages to the
phone number each user explicitly opted in with.

---

> **Note on sender ID:** US toll-free numbers do **not** support alphanumeric
> sender IDs — recipients will always see the number **+18337624449**, never a
> brand name. Messaging copy should not promise a branded sender for US SMS.
