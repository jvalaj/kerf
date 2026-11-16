# notes

## what i built and why

**sign-in.** you sign in with a username and password and get back a random token, which the app sends with every request. passwords are hashed with scrypt, and the database only keeps a hash of the token. i skipped jwts because you can't really cancel one, and i wanted sign-out to actually kill the session. i skipped cookies because the phone app and customers' tools need tokens anyway.

**live updates.** each device keeps one websocket open. the dashboard remembers the id of the last measurement it saw. when it reconnects it says "i'm at id 40" and the server sends everything after 40. ids only go up, so you can't miss one or get one twice. the event is sent from the same code that saves the measurement, so anything posted straight to the api shows up live too. i picked websockets over server-sent events because react native doesn't have sse built in. polling felt slow, and socket.io felt like too much library for one job.

**who's online.** same websocket: if you have one open, you're online. the server groups connections by person, so two devices show as one. devices ping every 15 seconds, and the server drops any device it hasn't heard from in 45.

**csv export.** each measurement gets two columns: the exact text the app shows (`30 1/16"`) and the same thing as a number (`30.0625`), rounded the same way. so a sum in excel matches what you see in the app. exporting only millimeters would not have matched the screen.

## what happens when things break

- **connection drops.** the app retries, waiting a bit longer each time (up to 10 seconds), then catches up from its last id.
- **api restarts.** sessions are in the database, so nobody is signed out. dashboards reconnect and catch up.
- **same person on two devices.** they show once and stay online until the last device closes.
- **a project you're not in.** you get a 404, as if it didn't exist. the live feed and csv check membership on the server every time.
- **seed data reset.** reset makes ids start over, which breaks "last id i saw". so the server keeps a random label that changes on reset, and dashboards reload when it changes.

## packages

- `ws`: small, standard websocket server for node.
- `expo-secure-store`: keeps the token in the phone's keychain.
- `expo-file-system` and `expo-sharing`: save the csv on a phone and open the share sheet.
- password hashing uses node's built-in `crypto`. `bcrypt` and `argon2` need compiling on install, which is a risk for a 10-minute setup.

## starter code that got in my way

- `/dev/reset` restarted ids and any user could call it. it's now dev-only, plus the reset label above.
- the schema uses `CREATE TABLE IF NOT EXISTS`, so an old database never got new columns. the api now rebuilds an outdated database.
- the feed was sorted by timestamp, and timestamps can tie. i sort by id.
- the api accepted labels and values of any size. i added limits.

## how i checked it works

- 45 automated tests: sign-in, access rules, catch-up, who's online, timeouts, csv escaping.
- by hand in a desktop browser and on a real iphone in expo go: wi-fi off and on, an api restart, a reset, two devices, and a frozen device.
- i opened the csv in excel and checked the sums.

## what i cut, and what's next

- after sign-in you always land on projects, even from a dashboard link. my fix was flaky, so i removed it.
- only the dashboard is live. project screens still load on open.
- with another week: safe retries for failed captures, api keys for customer tools, session expiry, and a shared message channel so the api can run as several processes.

## where the ai got it wrong

- it assumed expo go needs no account. my iphone showed an error saying the phone and the cli both had to be signed in to expo.
- it wrote a test helper that matched old messages instead of waiting for a new one. so a "who's online" test moved on too early and failed. the failing test is how i caught it, and i fixed the helper.
- its "return to the page you opened" code looked fine but did nothing in the browser. i found that by testing it, and removed it.
