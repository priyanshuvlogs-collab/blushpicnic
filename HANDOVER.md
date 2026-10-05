# Your website: how to look after it

Hello! This guide is for you, the owner of Blush Picnic. It explains how to change prices,
photos, questions and words on blushpicnic.com, and how to publish those changes, without
needing a developer.

Every fact and sentence on the site lives in a few plain text files. You edit a file, then
press one button to publish. If you make a mistake, the site refuses to publish and tells you
where the mistake is, so the live site never breaks.

- [How editing works](#how-editing-works)
- [Editing on GitHub in your browser](#editing-on-github-in-your-browser)
- [Common changes](#common-changes): prices, add-ons, picnic styles, travel fee, services, reply time, FAQs, occasion pages, booking questions, photos, reviews, contact details and analytics, policies and About
- [Publishing your changes](#publishing-your-changes)
- [One-time setup](#one-time-setup) (do this once, in order)
- [Waiting on you](#waiting-on-you): everything still marked "Placeholder"
- [If something goes wrong](#if-something-goes-wrong)

---

## How editing works

1. **Change a file** in the `src/content/` folder, on GitHub in your browser (easiest) or on a computer.
2. **GitHub checks it** automatically (a yellow dot, then a green tick ✓ next to your change, after a few minutes).
3. **You publish** with the "Deploy to Hostinger" button (see [Publishing your changes](#publishing-your-changes)).
   Nothing goes live until you press it.

### Five rules for editing these files

1. **Only change the words on the right of the colon**, e.g. `priceFrom: 375` → `priceFrom: 395`.
2. **Keep the quotes.** `name: "Signature Picnic"` must keep its `"…"`. If your text contains a
   double quote, use curly quotes instead: “like this”.
3. **Keep the spaces at the start of lines exactly as they are.** Spaces matter in these files;
   use spaces, never the Tab key.
4. **Don't change `id:` lines**, and don't rename files. Booking links and emails use them.
5. Lines starting with `#` are notes for you. The website ignores them.

---

## Editing on GitHub in your browser

1. Go to **github.com/priyanshuvlogs-collab/blushpicnic** and sign in.
2. Click through the folders to the file, e.g. `src` → `content` → `packages.yaml`.
3. Click the **pencil icon** ✏️ ("Edit this file") at the top right of the file.
4. Make your change.
5. Click **Commit changes…** (green button). In the box, write what you changed, e.g. "Signature price
   to $395". Keep **"Commit directly to the main branch"** selected, then click **Commit changes**.
6. Wait for the **green tick ✓** next to your change, on the main page of the repository (a few minutes).
   - A **red ✗** means the site couldn't be built from your change. Click it → "Details" to see
     which file and line. Usually it's a missing quote or a space. Edit the file again to fix it.
     The live site is unaffected.
7. When you're happy, [publish](#publishing-your-changes).

To **upload photos** through GitHub instead of the photo tool, see [Photos](#photos).

---

## Common changes

### Prices of the packages

**File:** `src/content/packages.yaml`

| What | Line to change | Example |
| --- | --- | --- |
| Starting price | `priceFrom:` | `priceFrom: 375` → `priceFrom: 395` (numbers only, no `$`) |
| Price per extra guest | `extraGuestPrice:` | `extraGuestPrice: 35` (the Signature). `extraGuestPrice: null` shows "we'll quote extra guests" instead (the Simple Picnic, Proposal & Romance and Celebration) |
| An extra note under the price (no amounts!) | `priceNote:` | `priceNote: "More than 8 guests? We'll quote your group."` |
| Guests included / maximum | `guestsIncluded:`, `guestsMax:`, `guestsLabel:` | `guestsLabel: "for 6–8 guests"` |
| Length | `durationHours:` | `durationHours: 2.5` |
| What's included | the lines under `includes:` | each starts with `    - "` |

The site adds "Starting at" and "before HST" by itself, and the booking estimate updates automatically.

There are four packages: `simple` (the Simple Picnic), `signature`, `proposal-romance` and `celebration`.
`includesFrom:` is the line shown above a package's list ("Everything in the Simple Picnic, plus:"): the
Signature inherits the Simple Picnic's list, and Proposal & Romance inherits the Signature's. The travel fee
(see [Travel fee by area](#travel-fee-by-area)) is added to every quote on top of these prices.

**That's the only place you change a price.** Occasion pages, FAQs and policies never have
prices typed into them — they use little placeholders in curly brackets that the website fills
in from this file when it's published:

| Write this in copy | It shows |
| --- | --- |
| `{price:simple}` / `{price:signature}` / `{price:proposal-romance}` / `{price:celebration}` | $250 / $375 / $495 / $1,200 |
| `{guests:celebration}` · `{hours:signature}` · `{guestsMax:celebration}` | 6–8 guests · 2 hours · 8 |
| `{extraGuest:signature}` | $35 (only for a package with a number in `extraGuestPrice:`) |
| `{deposit}` · `{depositPercent}` · `{securityDeposit}` | $100 · 50% · $100 |
| `{replyTime}` · `{locationNote}` · `{travelNote}` | "within 5 hours" and the two price sentences from `settings.yaml` |
| `{phone}` · `{email}` · `{instagram}` · `{tiktok}` | your contact details |

If you ever type a dollar amount into an occasion page or FAQ by hand, the publish log shows a
friendly warning so it doesn't go out of date.

### Add-on prices

**File:** `src/content/addons.yaml`

The add-ons are: balloon garland, fresh flowers, canopy or teepee, music system, umbrella, helium balloons,
charcuterie board, cake, beverages, red carpet walk, candle walkway and glassware. They're offered for
picnics and room decor (the booking form lists them for both).

The umbrella and the helium balloons already have a price. Every other add-on has `price: null`, which
shows **"Price on request"**. When you know a price, put the number instead:

```yaml
- id: balloon-garland
  name: "Balloon garland"
  …
  price: 150          # was: null
  priceSuffix: ""     # optional, e.g. " each" or " per hour"
```

The site adds "Starting at" and "before HST" by itself, so every add-on price is a starting price
(helium balloons: "Starting at $20" covers "$20 and up"). Prices you set here also appear in the booking
form's estimate. To go back to "Price on request", write `null` again.

**Glassware** is an add-on, not part of a package: its `description` says the tableware in the setups is
styled for the look and that disposable cutlery is available on request. If that's not quite how you'd
put it, change the words in `description:`.

### Picnic styles (dome, table & chairs)

**File:** `src/content/styles.yaml`

The three ways a picnic can be set: the **classic low table** (comes with every package), a **table & chair
setup** and a **dome picnic**. The booking form asks "How should we set your picnic?" and lists these.

- `price: null` shows **"quoted"**: the style is left out of the live estimate and you price it in your reply.
  When you know a price, put the number instead (e.g. `price: 150`); the site adds "Starting at" and
  "before HST", and the estimate includes it.
- `included: true` marks the one that comes with every package. Leave that on the classic low table only.
- `description:` is the sentence shown under the name. `image:` / `imageAlt:` are its photo (see [Photos](#photos)).

### Travel fee by area

**File:** `src/content/settings.yaml` → `travel:`

A travel fee is added to every quote (picnics, room decor and hamper deliveries), and the booking form asks
which area the client is in. For each area under `areas:`, `fee: null` means **"quoted by area"**: the
estimate says the travel fee is confirmed in your quote. Once you've decided a fee, put the number next to
the area (numbers only, no `$`):

```yaml
      - name: "Mississauga"
        fee: 40          # was: null
```

The sentence shown on the site is `note:` ("A travel fee is added by area. We confirm it with your quote.").
It also fills the `{travelNote}` placeholder in FAQs and policies. The form's area list is these areas plus
"Somewhere else in the GTA" and "Not sure yet", which never carry a fee.

### Services (room decor, hampers)

**File:** `src/content/services.yaml`

What Blush Picnic offers, shown on the home page and on `/services`, and as the first question of the
booking form ("What can we set up for you?"): **Picnics**, **Proposals**, **Room decor**, **Birthday hamper
delivery** (at midnight or during the day) and **Custom hamper** (DM with your vision).

- `name`, `short` (the line under the name), `summary` and `cta` (the button text) are safe to change.
- `href` is the page that explains the service: `/packages`, the proposal page, `/room-decor`, `/hampers`
  and `/hampers#custom`. Don't change the `id:` lines; booking links use them (`/book?service=room-decor`).
- `dm: true` (custom hamper) turns the button into an Instagram DM instead of the booking form.
- Pricing and what's included for room decor and the hampers aren't on the site yet: see
  [Waiting on you](#waiting-on-you).

### Reply time

**File:** `src/content/settings.yaml` → `replyTime: "within 5 hours"`

This one line is the reply promise everywhere: the header, the booking form and its confirmation email,
every occasion page, the FAQs and the policies (through the `{replyTime}` placeholder). If 5 hours ever
becomes hard to keep, change it here once; nothing else needs editing.

### Deposit, phone, email, Instagram, analytics

**File:** `src/content/settings.yaml`

- `phoneDisplay` is how the number is shown; `phoneE164` is the same number as `+1` and 10 digits, for the Call and Text buttons.
- `email`, `instagramHandle`, `instagramUrl`, `tiktokHandle`, `tiktokUrl`.
- `smsBody`: the message pre-typed when someone taps "Text us".
- `deposit` and `securityDeposit`: the amounts and the sentences shown on the site.
- `replyTime`: "within 5 hours" — see [Reply time](#reply-time).
- `travel`: the travel fee by area — see [Travel fee by area](#travel-fee-by-area).
- `serviceAreaList`: the towns listed as served.
- `analytics`: your **Google Analytics 4** ID (`G-…`) and **Meta Pixel** ID (digits only). See
  [One-time setup](#one-time-setup), step 9. They only switch on after a visitor accepts cookies.

The phone number and deposit amounts in FAQs, occasion pages and policies come from here too
(through the `{phone}` and `{deposit}` placeholders), so one change updates the whole site.

**Your logo** lives in `public/brand/` as SVG files taken from your Logo Guide (horizontal for the
header, reversed for the dark footer, plus the stacked, badge, basket-mark and app-icon versions).
If your designer sends the original SVG files, drop them in with the same names and ask your
developer to run `npm run brand` — that rebuilds the browser-tab icon, phone icons, the logo in
booking emails and the social-share image from them. There's no version number to change: the site
links each logo file with a short `?v=…` code worked out from the file itself, so a new logo gets a
new address and reaches people who visited before, too.

After publishing a new logo or tab icon (the first publish of this logo included), also:
1. **Flush Hostinger's CDN cache once:** hPanel → your website → Performance → CDN → Flush cache.
2. **Google:** in Search Console, inspect `https://blushpicnic.com` and click **Request indexing**,
   so Google fetches the new tab icon (search results can still take a few days to show it).
3. Optional: paste the home page into Facebook's Sharing Debugger and click **Scrape again**, so
   link previews on Facebook, Instagram and WhatsApp show the new image.

Safari and iPhones keep their own copy of tab icons, so the old one can linger there for a while.

### FAQs

**File:** `src/content/faqs.yaml`

```yaml
- id: how-to-book                     # a short unique name, lowercase-with-dashes
  question: "How do I book a picnic?"
  answer: "Send us a booking request through our [booking form](/book) …"
  category: booking                   # booking, pricing, the-day, locations or policies
  order: 1                            # position within its category
  showOnHome: true                    # also show on the home page (5–6 looks best)
```

- **Bold:** `**like this**`. **Link:** `[words to click](/policies)`.
- To **add** a question, copy a whole block (from `- id:` down to the line before the next
  `- id:`), paste it at the end, and give it a new `id`.
- To **remove** one, delete its whole block.

Each occasion page has its own FAQs, in its own file (next section).

### Occasion pages (Proposal, Birthday, Baby shower…)

**Files:** `src/content/occasions/<name>.md`, one per occasion, e.g. `proposal.md`, `baby-shower.md`.

The top part, between the two `---` lines, holds the page's settings and short texts:

| Field | What it is |
| --- | --- |
| `h1` | The big heading at the top of the page |
| `lede` | The paragraph under it |
| `heroAlt` | A description of the top photo (see [Photos](#photos)) |
| `highlights` | The 3–4 short points (`title` + `text`) |
| `faqs` | This page's questions (`q`) and answers (`a`) |
| `metaTitle` | The title Google shows. **Up to 65 characters**, ending in "\| Blush Picnic" |
| `metaDescription` | The grey text under it in Google. **70–160 characters** |
| `recommendedPackage` | Which package the page suggests (`simple`, `signature`, `proposal-romance` or `celebration`) |
| `related` | Up to 4 other occasions to suggest |

Below the second `---` is the page's main text. Write it like an email: a blank line between
paragraphs, and `## A heading` for a heading.

**Don't change** `urlSlug` (it's the page's address, and Google and Instagram links point to it)
or `formGroup` (it decides which booking questions appear).

### Booking form questions

**File:** `src/content/booking-form.yaml`

The form has 4 steps. Each block lists questions for everyone (`appliesTo: ["*"]`) or for some
occasions only (e.g. `appliesTo: ["birthday"]`).

**The first question is "What can we set up for you?"**: picnics, proposals, room decor, birthday hamper
delivery or a custom hamper (the list comes from `services.yaml`). The rest of the form follows that answer:
the picnic questions (package, guests, where, picnic style) only appear for picnics and proposals; room decor
asks what kind of room and its address; hampers ask whether to deliver at midnight or during the day, the
delivery address, a card message and allergies. The `showIf:` line under a question is what decides this.

Some answers are filled in for the client and the question hidden (the `lockBy:` lines under the occasion
question): choosing **Proposals** sets the occasion to "Proposal", **Birthday hamper delivery** sets it to
"Birthday", and **Custom hamper** sets it to "Something else". Everyone is also asked which area they're in
(for the travel fee), and picnic bookers choose their picnic style (classic low table, table & chairs or dome).

**Safe to change:** `label` (the question), `help` (the small hint under it), `placeholder` (the
grey example text), `options` (the choices), and `required: true` / `false`.

**Don't change** a question's `id`. Your booking emails and the server's checks use it. To retire
a question, ask your developer: the form and the server must agree on it.

The server checks every request against this same file, so there's never any code to update.

### Photos

Your own photos so far: the home page photo, the top photos of the Birthday, Anniversary and Proposal
pages, and five in the gallery (Birthdays, Anniversaries and Proposals). Client names on the letter boards are blurred.
The rest are still **AI illustrations** made with Grok (xAI) to show the style of your setups. They
are not photos of real Blush Picnic events. The photos themselves carry no label,
but the site says so in one place each: a short note on the gallery, the home gallery, the occasion
pages, /occasions, /packages, /services, /room-decor and /hampers, and one line in the footer. Link previews (WhatsApp, Facebook…) and Google get
your logo image instead of an AI one. Replace them with your own photos as soon as you can (below):
a real photo takes over its spot, the notes update by themselves, and it's used in link previews and
for Google too. The About photo is still a placeholder,
because it should be you. The Simple Picnic, the room decor and hamper pictures and the two picnic
styles (table & chairs, dome) are AI illustrations like the rest, labelled on /services, /room-decor,
/hampers and /packages until you send those photos.

**The easy way: the photo tool (on a computer with the project).**

1. Make a folder, e.g. on your Desktop, and put your photos in it, **named like this**:

   | File name | Where it appears |
   | --- | --- |
   | `hero.jpg` | The big photo on the home page (also on your Instagram links page) |
   | `about.jpg` | The About page: you, or your hands styling a setup |
   | `pkg-simple.jpg`, `pkg-signature.jpg`, `pkg-proposal-romance.jpg`, `pkg-celebration.jpg` | The four packages |
   | `service-room-decor.jpg`, `service-birthday-hamper.jpg`, `service-custom-hamper.jpg` | Room decor and the hampers (services page and home) |
   | `style-table-chairs.jpg`, `style-dome.jpg` | The table & chair setup and the dome picnic (picnic styles) |
   | `occasion-proposal.jpg`, `occasion-birthday.jpg`, … | The top of each occasion page (any name from `src/content/occasions/`) |
   | `gallery/proposal/` (a folder) with any photos inside | Gallery photos for that occasion. Make one folder per occasion |

2. Run `npm run photos -- ~/Desktop/my-photos --dry-run` to see what would happen. Then run it
   again without `--dry-run`.

The tool turns photos upright, resizes them, and **removes all hidden information, including the
GPS location** your phone stores in every photo. That matters: a photo taken at a client's home
can reveal the address. It adds gallery photos to `src/content/gallery.yaml` and removes the
placeholder images for that occasion. iPhone HEIC photos must be exported as JPEG first (the
tool tells you how).

3. **Describe each new photo.** The tool lists exactly where. Descriptions are read aloud to
   blind visitors and help Google, so write what's actually in the picture: *"Low table set for
   two with blush roses, candles and a 'Marry Me' sign on the grass at sunset"*. Replace any
   description that still says "Placeholder". For gallery photos, the tool marks each one with
   `# TODO: describe this photo`; delete that note once you've written it.

**Without a computer (on GitHub):** open `src/assets/photos/`, click **Add file → Upload files**,
and upload a photo with **exactly** the same name as the one it replaces (e.g. `hero.jpg`). Before
uploading, remove the location: on iPhone, tap Share → **Options** → turn off **Location**, then
"Save to Files". Then update the description, as in step 3.

**Good photos:** at least 1600 pixels on the long side for the home, About and occasion photos;
portrait (taller than wide) suits those spots best. Landscape works well for packages.

**New AI illustrations** (only until you have real photos): on GitHub go to **Actions → Generate
AI photos → Run workflow**. Leave the boxes empty to fill any missing ones, or type file names
(e.g. `occasion-birthday.jpg, gallery-family-2.jpg`) to redo just those. It uses your
`XAI_API_KEY` secret, never touches a real photo you've added, and commits the new images to the
branch you ran it on; then describe each new image and publish. The scene for each photo is
written in `scripts/ai-photos.mjs` (no people, no text, no alcohol or confetti).

### Reviews

**File:** `src/content/reviews.yaml`

The reviews section stays **hidden until you add the first review**. Only add **real** reviews,
copied word for word, from a client who said yes to you sharing them, with their first name and
last initial only. Never write, edit or "improve" a review. (Copy the example block at the top of the file.)

### Policies, About, Privacy

**Files:** `src/content/pages/policies.md`, `about.md`, `privacy.md`

Write like an email. Words in `{curly braces}` (like `{deposit}` or `{phone}`) are filled in from
`settings.yaml`, so they always match. Each file has a "HOW TO EDIT THIS PAGE" note at the top.
Replace each `<p class="placeholder-note">…</p>` line with your real text when you have it.

---

## Publishing your changes

**Option A: the GitHub button (recommended).**

1. On GitHub, open the **Actions** tab.
2. Click **Deploy to Hostinger** on the left.
3. Click **Run workflow** (right side). Under "Use workflow from" choose **main**, then **Run workflow**.
   (Started from any other branch, it stops with a red ✗ that says so: merge the changes into main first.)
4. Wait 2–4 minutes for the green tick ✓. The last step checks the live site for you.
5. Open https://blushpicnic.com and refresh.

(This needs the three secrets from [One-time setup](#one-time-setup), step 2.)

**Option B: from a computer** (for you or your developer): `./deploy.sh`. It builds the site,
saves a backup of the live site the first time, uploads, double-checks every file and tests the
live site. See [docs/deployment.md](docs/deployment.md).

**To undo a publish:** Actions → Deploy to Hostinger → open the last run that was fine → **Re-run all jobs** (GitHub allows this for runs from the last 30 days; older ones: ask your developer, docs/deployment.md → Rolling back).

---

## One-time setup

Do these once, in this order. Menus are named as in Hostinger's hPanel; if one has moved, use
hPanel's search box.

### 1. Change the FTP password (it was shared in a chat)

The FTP password was sent in a chat while the site was being set up, so treat it as public.

1. hPanel → **Files** → **FTP Accounts**.
2. Change the password for your FTP account (the username starting with `u…`). Save the new one in your password manager.
3. Never send it by chat or email. Only put it in the places below.

### 2. Add the three GitHub secrets (for the Deploy button)

GitHub → the repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, three times:

| Name | Secret |
| --- | --- |
| `FTP_SERVER` | the "FTP IP (hostname)" from hPanel → Files → FTP Accounts (without `ftp://`) |
| `FTP_USERNAME` | the "FTP username" from the same page |
| `FTP_PASSWORD` | your new FTP password |
| `SMTP_PASSWORD` | the password of the **support@blushpicnic.com** mailbox — the Deploy then writes `blush-config.php` for you, outside `public_html` (optional: you can also create that file by hand, step 5) |

Secrets can't be read back, not even by you, so you'll never see the password on GitHub again.

### 3. Turn on SSL (the padlock)

hPanel → **Security** → **SSL**: make sure blushpicnic.com has an active certificate (the free one
is fine), covering `www` too. Do this before the first publish, because the site always sends
visitors to the secure `https://` address.

> **About "HSTS":** the site tells browsers to *only* use the secure address for the next year.
> It's standard for any site with SSL and protects visitors on public Wi-Fi. The one consequence:
> **never switch SSL off for blushpicnic.com.** We chose not to apply it to subdomains (so
> something like `shop.blushpicnic.com` without SSL would still work) and not to "preload" it
> into browsers, so it's easy to undo by removing one line from `public/.htaccess`.

### 4. The booking email mailbox

1. hPanel → **Emails** → **Email Accounts**: make sure **support@blushpicnic.com** exists (create it if not).
2. Note its password. Booking requests are sent *from* this mailbox *to* blush.picnic25@gmail.com,
   and every client gets an automatic confirmation from it.

### 5. Put the booking settings on the server (`blush-config.php`)

The booking form needs the mailbox password, and it must live **outside** the public website folder.

1. On GitHub, open `api-config/blush-config.example.php`, click the **copy** icon (Copy raw file), and
   paste it into a plain-text editor (TextEdit in plain-text mode, or Notepad).
2. Find `'smtp_password' => '',` and type the mailbox password between the two quotes:
   `'smtp_password' => 'your-mailbox-password',`. Change nothing else.
3. Save the file as **`blush-config.php`**.
4. hPanel → **Files** → **File Manager**. Go to **domains** → **blushpicnic.com**. You'll see the
   `public_html` folder there; **stay in this folder, next to it, not inside it**.
5. Click **Upload** and choose `blush-config.php`.
6. Delete the copy on your computer.

(Or, from a computer: `./deploy.sh --config path/to/blush-config.php`.)

### 6. Publish for the first time

[Publish](#publishing-your-changes). The last step should show "All checks passed", including
"Booking handler runs and found blush-config.php".

### 7. Send yourself a test booking

1. Open https://blushpicnic.com/book on your phone and fill it in with your own details.
2. Within a minute, the request should arrive at **blush.picnic25@gmail.com**, and the
   confirmation at the email address you entered.
3. Not there? Look in **Spam**, open it, and mark it **"Not spam"**. Then do step 8.

### 8. Help your emails reach inboxes (SPF, DKIM, DMARC)

These three settings prove to Gmail and others that emails from @blushpicnic.com are really
yours. Without them, confirmations can land in spam. In hPanel, open **Emails** → your domain;
Hostinger shows which records are missing and can usually add them for you. If you add them by
hand (hPanel → **Domains** → blushpicnic.com → **DNS / Nameservers**), they are:

| Type | Name | Value |
| --- | --- | --- |
| TXT | `@` | `v=spf1 include:_spf.mail.hostinger.com ~all` (if one `v=spf1` record exists, edit it: there must be only one) |
| TXT / CNAME | as shown in hPanel → Emails (DKIM) | the value Hostinger gives you |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:blush.picnic25@gmail.com` |

After a few weeks of clean reports, you can change `p=none` to `p=quarantine`. Then send the test booking (step 7) again.

### 9. Analytics (optional, any time)

- **Google Analytics 4:** create a property for blushpicnic.com at analytics.google.com, copy the
  Measurement ID (`G-XXXXXXXXXX`), and paste it into `src/content/settings.yaml` → `ga4Id`.
- **Meta Pixel:** Meta Events Manager → your pixel → copy the ID (digits) into `metaPixelId`.
- Publish. A cookie banner appears, and tracking starts only for visitors who accept.
  The privacy page explains this to visitors; review it (see [Waiting on you](#waiting-on-you)).

### 10. Google

Follow [SEO.md](SEO.md): Google Business Profile, Search Console, reviews.

---

## Waiting on you

Items marked **(draft)** are shown on the site as our best reading of what you told us — please
confirm or correct them. Everything else shows a visible "Placeholder" until you send it; nothing
has been made up in its place.

<!-- PLACEHOLDERS:START -->

**Policies** (`src/content/pages/policies.md`): the deposit, security deposit, payment, weather,
cancellation, setup/pickup times, late-arrival, extra time, rental damage, clean-up, confetti and
permit sections were written from your booking-confirmation email. **Please read
https://blushpicnic.com/policies once and confirm every line is right.**

- [ ] **Weather policy**: confirm the wording (unsafe weather → rescheduled, deposit moves to the new date, no refunds for weather).
- [ ] **Cancellation / rescheduling**: confirm the wording (no refunds within 48 hours of the event). Anything about rescheduling further ahead?
- [ ] **Damage to decor**: confirm the wording (deducted from the $100 security deposit, extra charged).
- [ ] **Permits**: confirm the wording (the client gets any permit the park or venue needs).
- [ ] **Alcohol**: your stance (still a placeholder on /policies).
- [ ] **Accepted payment methods** (still a placeholder on /policies).
- [ ] **About page**: your story in your own words (3–4 short paragraphs) and a photo of you (`about.jpg`).
- [ ] **More real photos**: packages, the other occasions, gallery (home, Birthday and Anniversary are done). Use `npm run photos` (see [Photos](#photos)).
- [ ] **Add-on prices**: balloon garland, fresh flowers, canopy or teepee, music system, charcuterie board, cake, beverages, red carpet walk, candle walkway and glassware still show "Price on request" (`addons.yaml`). The umbrella and helium balloons are priced.
- [ ] **Glassware and cutlery wording**: the site says glassware is an add-on, the tableware in the setups is styled for the look, and disposable cutlery is available on request. Confirm that's right (`addons.yaml` → glassware → `description`).
- [ ] **Simple Picnic — what's included? (draft)** The site lists a low picnic table, rugs and cushions, tableware, florals and a letter board, for 2 guests and 2 hours. Confirm the list and the length (`packages.yaml` → `simple`).
- [ ] **Simple Picnic — extra guests**: there's no published price, so the site says "we'll quote extra guests". Give us a number if you'd like one shown (`extraGuestPrice:`).
- [ ] **Signature Picnic — does it keep $375?** With the Simple Picnic at $250 underneath it, confirm the Signature stays at $375 (+$35 per extra guest) for the umbrella, speaker and games.
- [ ] **Dome and table & chair prices**: both show "quoted" (`styles.yaml`). **(draft)** Their one-line descriptions are ours — correct them if a dome or the table & chair setup is something different.
- [ ] **Travel fee per area**: the site says a travel fee is added by area and confirmed with the quote. Add the number for each area once you've decided (`settings.yaml` → `travel` → `areas`).
- [ ] **Travel fee — which bookings? (draft)** You gave it for the Simple Picnic. The site applies it to every package, to room decor and to hamper deliveries. Tell us if any of those shouldn't carry it.
- [ ] **Room decor (draft)** — the /room-decor page is our draft: confirm where you set up (we say at home, in a hotel room or a rental), which occasions, which add-ons you offer in a room (we list balloon garland, fresh flowers, helium balloons, candle walkway, red carpet walk, cake, charcuterie board, beverages), whether the decor is rented and collected afterwards (the site applies the $100 security deposit to room decor), and how it's priced (`services.yaml`, `src/pages/room-decor.astro`).
- [ ] **Hampers (draft)** — what's in a birthday hamper, its price, how a custom hamper is priced, and whether any deposit applies to a hamper delivery (the site asks for the $100 booking deposit but **no security deposit** for hampers, since nothing is collected; `services.yaml` → `securityDeposit`).
- [ ] **Cake & beverage**: you listed it as one add-on; the site shows "Cake" and "Beverages" separately. Say if you'd rather they were one (`addons.yaml`).
- [ ] **Reviews**: real ones only, with the client's permission (`reviews.yaml`).
- [ ] **GA4 Measurement ID** (`settings.yaml` → `ga4Id`).
- [ ] **Meta Pixel ID** (`settings.yaml` → `metaPixelId`).
- [ ] **Privacy policy review**: have it checked, then fill in: the date it takes effect, who handles privacy questions, where your email and hosting providers store data (`privacy.md`).
- [ ] **How long you keep booking emails and records** (retention period, `privacy.md`).
- [ ] **Celebration package — what's included?** Does it include the Signature basics (low table, rugs and cushions, tableware, florals, letter board, umbrella, speaker, games)? If yes, add `includesFrom: "Everything in the Signature Picnic, plus:"` to `celebration` in `packages.yaml` — the comparison table on /packages then shows ticks instead of "Ask us".
- [ ] **Kids and the extra-guest price**: are kids charged the $35 extra-guest rate on the Signature Picnic? For now the booking estimate prices extra adults and says "we'll confirm pricing" for kids.
- [ ] **Invoices for companies**: do you issue invoices (and do they show HST)? The corporate page only says "tell us if you need an invoice".
- [ ] **Instagram photo promise**: the About and Privacy pages say you only share photos of a setup if the client says yes (the booking form asks), and that you'll take a photo down on request. Confirm you're happy with that.

<!-- PLACEHOLDERS:END -->

---

## If something goes wrong

| What you see | What to do |
| --- | --- |
| A red ✗ after editing on GitHub | Click it → Details. It names the file and line. Usually a missing `"` or a space at the start of a line. Fix and commit again. The live site is untouched |
| The Deploy button failed at "Check the three FTP secrets" | Add the secrets ([setup step 2](#2-add-the-three-github-secrets-for-the-deploy-button)) |
| The Deploy button failed at "Upload" | The FTP password may have changed: update the `FTP_PASSWORD` secret |
| "Booking handler can't read blush-config.php" | Re-do [setup step 5](#5-put-the-booking-settings-on-the-server-blush-configphp). The file goes *next to* `public_html`, not inside it |
| Bookings stopped arriving | Check spam, then send a test booking. If the mailbox password changed, update it in `blush-config.php` on the server (File Manager → domains → blushpicnic.com → blush-config.php → Edit). Requests that couldn't be emailed are saved in `domains/blushpicnic.com/blush-data/unsent/` and open in any email app |
| A request arrives with "[Possible spam]" in the subject | Our spam filter wasn't sure. Read it — if it's a real client, reply as normal. |
| Tidying up (every few months) | Delete files in `domains/blushpicnic.com/blush-data/unsent/` once you've handled them (the privacy page promises this), and old `booking-YYYY-MM.log` files in `blush-data/`. |
| The site looks wrong after publishing | Undo it: Actions → Deploy to Hostinger → last good run → **Re-run all jobs** |
| Browser says "not secure" | SSL is off or renewing: hPanel → Security → SSL |

More detail for developers: [README.md](README.md) and [docs/deployment.md](docs/deployment.md).
