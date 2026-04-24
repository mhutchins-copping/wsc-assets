# Onboarding

> **Document:** Onboarding — new maintainer / trainee
> **Version:** 1.0
> **Last updated:** 2026-04-23
> **Owner (role):** IT Officer, Walgett Shire Council

This is the document to read on day one. It's written for someone who
knows their way around Windows IT but hasn't worked on a web application
before. If you already know what Cloudflare Workers and D1 are, you can
skip the concepts section and go straight to [Day one](#day-one-get-it-running-locally).

The three other documents in this folder — `ARCHITECTURE.md`,
`OPERATIONS.md`, `GOVERNANCE.md` — answer the *what*, *how*, and *who
cares* questions. This one answers *where do I start*.

## Contents

- [What you're inheriting](#what-youre-inheriting)
- [Concepts you'll meet](#concepts-youll-meet)
- [Day one: get it running locally](#day-one-get-it-running-locally)
- [Your first change](#your-first-change)
- [The mental model](#the-mental-model)
- [Common pitfalls](#common-pitfalls)
- [Where to ask questions](#where-to-ask-questions)
- [Further reading, in order](#further-reading-in-order)

## What you're inheriting

WSC Assets is a small, internal, single-tenant web app. It tracks every
piece of IT hardware the council owns and who has it. It replaced a
spreadsheet.

Practically, it's four things:

1. A website at `assets.it-wsc.com` that staff sign into.
2. An HTTP API at `api.it-wsc.com` that the website talks to.
3. A database of assets, people, and history.
4. A handful of scheduled jobs (weekly backups, post-deploy smoke tests).

It runs on Cloudflare. There are no servers to patch and no scheduled
maintenance windows. Everything deploys from a GitHub push.

You'll be the sole maintainer day-to-day once handover finishes. This
is a realistic workload — the code is small, the users are forgiving,
and most days there's nothing to do. When something does break, it
breaks loudly (CI goes red, emails arrive) and the runbook in
`OPERATIONS.md` is there for exactly those moments.

## Concepts you'll meet

Just enough of each that you can read the rest of the docs without
getting tripped up. Not a tutorial — a map.

**Cloudflare.** Everything in this app lives on Cloudflare. Think of
Cloudflare as a single provider that offers several distinct services
(listed below). The council has one Cloudflare account, and that
account owns the whole stack.

**Cloudflare Workers.** Small pieces of JavaScript that run on
Cloudflare's servers when a request comes in. Our API is one Worker
(the single file `worker/worker.js`). No VM, no container, no
long-running process — Cloudflare spins up the code when someone makes
a request and shuts it down when there's nothing to do.

**Cloudflare Pages.** Hosting for static websites. Our frontend
(everything under `src/` after the Vite build) lives on Pages. Same
deployment model as Workers — push, it's live.

**Cloudflare D1.** A SQLite database provided by Cloudflare, accessed
from inside the Worker. It's regular SQL. You can open a web console
to run queries ad-hoc, which you'll do occasionally.

**Cloudflare R2.** Object storage. Same idea as Amazon S3. We use it
for asset photos (the user uploads a JPG, we put it in R2, the URL
goes in the database).

**Cloudflare Access.** The SSO gate that sits in front of the whole
app. When a staff member types `assets.it-wsc.com`, Access intercepts
the request, bounces them to Microsoft Entra ID for sign-in, and only
then forwards the request to our site. Our code never sees a password
— Access hands us an authenticated email address in a signed header.

**Wrangler.** Cloudflare's command-line tool for managing Workers,
Pages, and D1. You'll use it for deploying manually, running database
migrations, and rotating secrets. Installed via `npm install` inside
`worker/`.

**Microsoft Entra ID.** Microsoft's identity service (used to be
called Azure AD). Every council staff member already has an Entra
account — that's what they use to sign into email. We plug into it for
SSO via Access.

**Microsoft Graph.** Microsoft's API for reading / writing Entra and
Microsoft 365 data. We use it to sync the staff directory into the
`people` table and to send notification emails from the IT account.

**Vite.** A build tool for the frontend. When you run `npm run dev`, Vite
serves the site with hot-reload (save a file, the browser updates).
When CI runs `npm run build`, Vite bundles everything into a production
`dist/` folder. It's a tool, not a framework — the code it's bundling
is plain JavaScript.

**GitHub Actions.** Our CI. Defined in `.github/workflows/*.yml`. The
one you'll see most is `deploy.yml`, which runs on every push to
`main`: build frontend, run migrations, deploy worker, smoke-test.

## Day one: get it running locally

Goal by end of day: see the app running on your own machine, hitting
the real API, with your council email showing in the sidebar.

### Prerequisites

- **Windows 10 / 11** or macOS. Linux works too but the instructions
  below assume Windows for now.
- **Node.js 20 or newer.** Install from <https://nodejs.org>.
- **Git.** Install from <https://git-scm.com>.
- **A code editor.** VS Code is the default; anything works.
- **GitHub access** to the repository. Matthew will add your account
  before your first day.
- **Cloudflare access** with permission to view (not deploy) the WSC
  Assets project. Matthew handles this.

### Clone the repo

```bash
git clone https://github.com/mhutchins-copping/wsc-assets.git
cd wsc-assets
```

### Install dependencies (two places)

There are two `package.json` files, one for the frontend and one for
the worker. You install both.

```bash
npm install                 # frontend
cd worker && npm install    # worker (wrangler, etc.)
cd ..
```

### Boot the frontend

```bash
npm run dev
```

That opens a Vite dev server on <http://localhost:3002>. You should
see the app's login screen.

Because the frontend talks to the *real* production API at
`api.it-wsc.com`, signing in here uses the same SSO flow as the live
site. If CF Access challenges you, sign in with your council email
and you'll land in the app with live data. You're looking at prod
data through your local frontend — which is fine for read-only
exploration and means no data seeding is needed. **Don't write or
delete anything until you know what you're doing.**

### Don't boot the worker locally yet

It's possible to run the worker locally (`cd worker && npm run dev`),
but it needs a local D1 database and a set of dummy secrets. Save
that for week two — your local frontend against the real prod API is
enough to get oriented.

### What success looks like

- `http://localhost:3002` renders the WSC Assets login screen with the
  council logo and green colour scheme.
- After signing in, your name appears in the sidebar footer.
- You can click around the Assets list, open a device, see the
  history.
- Any edit (create, assign, delete) persists to the real database. So
  — read-only for now.

If any of the above is broken, that's the first thing to get working
before moving on. Common causes:

- `npm install` failed with a permissions error → run your terminal
  as administrator, try again.
- `npm run dev` says the port's in use → someone else (or you
  previously) is already on 3002. Kill that process or change the
  port with `npm run dev -- --port 3003`.
- Login redirects infinitely → your CF Access session is stale. Open
  the app in a fresh private / incognito window.

## Your first change

Goal: ship a real change end-to-end, so you understand the full loop.

Pick something small and visible. A good example: change the text of
a button, or add yourself as a "helped by" credit somewhere in the
footer. You want to see your change appear on the live site, not
solve a hard problem.

### Steps

1. **Make a branch.** Don't work on `main`.

   ```bash
   git checkout -b first-change
   ```

2. **Find where to edit.** The UI is all HTML strings in the files
   under `src/js/`. Use your editor's project-wide search
   (Ctrl+Shift+F in VS Code) to grep for the text you want to change.

3. **Edit, save, refresh.** With `npm run dev` running, your change
   appears in the browser immediately — no rebuild needed.

4. **Commit and push.**

   ```bash
   git add .
   git commit -m "tiny change to X"
   git push -u origin first-change
   ```

5. **Open a pull request** on GitHub. Matthew will review it.

6. **Merge it.** Once approved, merging to `main` triggers
   `.github/workflows/deploy.yml`. Watch it run in the Actions tab.
   If all four steps go green (build, migrate, deploy, smoke-test),
   your change is live on `assets.it-wsc.com` within about 90 seconds.

7. **Verify in prod.** Open the live site. Refresh. Your change is
   there.

That full loop — edit → push → CI → live — is the one you'll do dozens
of times. Getting comfortable with it in week one is the main goal of
this exercise.

## The mental model

After a week of poking around you'll start to recognise the same
patterns. This section just names them so the code is easier to read.

**Frontend is dumb; the worker is smart.** The frontend doesn't know
permissions, doesn't do validation that matters, doesn't decide what
a user can see. It fetches JSON, renders it, and sends JSON back. The
worker decides everything. If you're ever tempted to add a rule on the
frontend only, don't — the worker is the only place that can be trusted.

**Every request is authenticated.** Every `/api/*` call is gated by
Cloudflare Access + the internal `users` table. See `ARCHITECTURE.md §
How auth works` for the specifics. You don't need to add auth when
you add a new endpoint — the dispatcher at the top of `worker.js`
already runs it for every request.

**Permissions are a lookup.** The worker has a `ROLE_PERMISSIONS`
map and a `deny('name.thing')` helper. When you add a new endpoint,
decide which permission it needs and wire in the guard. Don't roll
your own role check inline.

**The database is small on purpose.** Eight or so tables, plain SQL,
no ORM, no joins fancier than `LEFT JOIN people`. If you reach for a
migration that adds five tables, stop and check with someone.

**Adding a new feature usually means touching four places:**

1. A migration in `worker/migrations/` (if the schema changes).
2. An update to `worker/schema.sql` so fresh installs match prod.
3. A handler + route in `worker/worker.js`.
4. UI in `src/js/<something>.js` + possibly `src/css/app.css`.

Small features fit in one commit that edits all four files.

## Common pitfalls

- **Never commit secrets.** Anything that looks like an API key, a
  password, a client secret, a token. `.gitignore` blocks `.env*` by
  default but it won't catch a key pasted into source. If you do it
  by accident, tell Matthew *immediately* — the remediation is
  rotating the secret, not removing the commit (Git history is
  forever).
- **Don't push straight to `main`.** Every change goes via a branch +
  PR. Even tiny ones. The branch protection rule enforces this.
- **If you add a column, add a migration AND update `schema.sql`.**
  Migrations are for upgrading existing databases. `schema.sql` is for
  bootstrapping fresh ones. Both have to agree.
- **The worker is one file on purpose.** It's long but organised with
  `// ─── Section ───` banners. Don't split it into modules — the "one
  file you can read top-to-bottom" property is load-bearing for
  whoever comes after you. If you need to add a helper that isn't a
  request handler (e.g. email templating), `worker/lib/` is fine.
- **No TypeScript. No framework.** If you come from a React / Next
  background, the instinct will be to introduce them. Don't — the
  reasoning is in `ARCHITECTURE.md § Why vanilla JavaScript`.
- **Test in production with care.** Because dev hits the real API,
  it's easy to accidentally delete a real row. Use filters,
  read-only tabs, and your own test asset before experimenting.
- **CI is the safety net, not the first line.** Run `npm run build`
  locally before pushing — catches most syntax breaks in two seconds
  instead of waiting three minutes for Actions.
- **Check the Actions tab after every merge.** Even if you *expect* it
  to pass. The smoke test has caught real production-breaking bugs
  that looked fine locally.

## Where to ask questions

While handover is active:

- **Matthew (current maintainer)** — direct questions, code review,
  architectural decisions. In-person when possible; otherwise Teams.

Once handover finishes:

- **Matthew remains contactable** for the first three months for
  anything load-bearing. After that, you're it.
- **The code itself** is the best source of truth. Every unusual
  decision has a comment explaining *why*. When something looks
  wrong, assume the comment is right and the situation is unusual,
  until proven otherwise.
- **The runbook** (`OPERATIONS.md`) handles every incident type that's
  happened more than once.
- **Cloudflare support** — reachable from the dashboard. Useful for
  platform-level weirdness (worker not deploying, D1 console not
  loading). Slow, but correct when it matters.

## Further reading, in order

Once you've done your first change, read these in order. Each takes
about 15–30 minutes.

1. **`ARCHITECTURE.md`** — the *why* behind the stack. Read this
   before touching anything non-trivial.
2. **`worker/worker.js`** — top to bottom, banner by banner. You
   won't remember it all but you'll recognise things later.
3. **`worker/schema.sql`** — the database shape. Short. Read it twice.
4. **`OPERATIONS.md`** — the runbook. Scan once now; re-read each
   section when you need to actually do the thing.
5. **`GOVERNANCE.md`** — the executive one-pager. Useful before any
   conversation with the GM or council audit.

After that, the features listed in the root `README.md` give you a
menu of areas to explore — each feature usually lives in a single JS
file on the frontend plus a handful of endpoints in the worker.
