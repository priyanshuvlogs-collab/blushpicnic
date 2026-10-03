# Getting found on Google: your checklist

The website is already built to rank locally: fast pages, one page per occasion
("proposal picnic Toronto", "baby shower picnic Toronto"…), structured data that tells Google
you're a local business serving the GTA, a sitemap, and clean addresses. What's left is done
outside the website, mostly once. Tick things off as you go.

> **Golden rule:** everything you publish about the business, everywhere, must be true. No
> invented reviews, no "#1 in Toronto", no fake addresses. Google removes listings for less, and
> clients can tell.

---

## 1. Google Business Profile (the most important item)

This puts you on Google Maps and in the "local pack" when someone searches *picnic setup near me*.
Go to **business.google.com** and create (or claim) **Blush Picnic**.

- [ ] **Business type: service-area business.** You travel to clients, so choose "I deliver goods
  and services to my customers", and **hide your address**. Don't use a home address, PO box or
  virtual office as a storefront. Google suspends those.
- [ ] **Name:** exactly `Blush Picnic`. No keywords added (not "Blush Picnic – Luxury Picnics
  Toronto"). Adding keywords breaks Google's rules and can get the profile suspended.
- [ ] **Categories:** search Google's list and choose the closest match as the **primary**
  category (for example *Event planner* or *Party planner*), then add 2–3 secondary ones that are
  true (for example *Party equipment rental service*). You can test and change these later.
- [ ] **Service areas:** Toronto, North York, Scarborough, Etobicoke, East York, Mississauga,
  Brampton, Vaughan, Markham, Richmond Hill, Oakville, Pickering, Ajax. These match the website.
  Only list areas you really serve. Google allows up to 20.
- [ ] **Phone:** `(647) 878-0539`.
- [ ] **Website:** `https://blushpicnic.com/?utm_source=google&utm_medium=organic&utm_campaign=gbp`.
  The ending lets Analytics show how many visitors come from your profile; the page is the same.
- [ ] **Booking / appointment link:** `https://blushpicnic.com/book`
- [ ] **Hours:** the hours you actually answer messages and book (people see "Open now").
- [ ] **Description** (750 characters max): what you do, where, for which occasions, in plain
  words. You can adapt the "About" page text.
- [ ] **Products:** add each package as a product: Signature Picnic, Proposal & Romance,
  Celebration, with a real photo, the "starting at" price **before HST** (as on /packages), and a
  link to `https://blushpicnic.com/packages`.
- [ ] **Photos:** add real setups regularly (aim for a few new ones every month), plus your logo
  (`public/logo.png`) and a cover photo. Real photos only.
- [ ] **Posts:** a short post every week or two: a recent setup, a seasonal idea, a new add-on.
  Use the "Book" button pointing to `/book`.
- [ ] **Messages / Q&A:** turn on chat only if you'll answer within a day. Your website promises
  replies within 24 hours.

## 2. Reviews: ask every happy client

Reviews are the strongest local ranking signal you control.

- **When:** within a day or two of the picnic, while they're still glowing, ideally right after
  you've sent them their photos.
- **How:** in your Business Profile, click **"Ask for reviews"** to get your short review link.
  Save it in your phone's text replacements (e.g. type `rvw` → link).
- **Script** (adapt freely):

  > Hi [name]! Thank you so much for letting us set up your [proposal/birthday] picnic. It was
  > such a joy. If you have a minute, a Google review would mean the world to a small business
  > like ours: [link]. And if anything could have been better, tell us directly, we'd love to know. 💗

- **Reply to every review**, good or bad, within a few days. Be kind and specific, and don't
  include private details.
- **Never:** offer discounts, gifts or entries for reviews; ask only happy clients and steer
  others away ("review gating"); write reviews yourself or ask friends to; review competitors.
  All of these break Google's rules and can wipe your reviews or the whole profile.
- **On the website:** with a client's permission, copy a review word for word into
  `src/content/reviews.yaml` (see HANDOVER.md → Reviews).

## 3. Keep your name, phone and website identical everywhere ("NAP")

Google cross-checks your details across the internet. Use exactly:

| | Write it exactly as |
| --- | --- |
| Name | `Blush Picnic` |
| Phone | `(647) 878-0539` |
| Website | `https://blushpicnic.com` |
| Area | Toronto & the GTA (no street address) |

- [ ] Instagram profile: name, phone/contact button, website.
- [ ] TikTok profile.
- [ ] Every listing in section 6.
- [ ] If the phone number ever changes, update `src/content/settings.yaml` **and** every listing on the same day.

## 4. Instagram bio link

- [ ] Set your Instagram (and TikTok) bio link to **`https://blushpicnic.com/links`**. That page
  was made for visitors from your bio: big buttons for booking, packages, texting you and the
  gallery, fast on phones.
- [ ] In story links and posts, link straight to the right page, e.g.
  `https://blushpicnic.com/proposal-picnic-toronto` or `https://blushpicnic.com/book?occasion=birthday`.

## 5. Google Search Console and Bing

**Google Search Console** shows which searches find you and warns you about problems.

- [ ] Go to **search.google.com/search-console** → Add property → **Domain** → `blushpicnic.com`.
- [ ] Verify with the **DNS TXT record** it gives you: hPanel → Domains → blushpicnic.com → DNS /
  Nameservers → add a TXT record → paste. Verification can take up to an hour.
- [ ] **Sitemaps** → submit `https://blushpicnic.com/sitemap-index.xml`.
- [ ] Use **URL Inspection** on the home page → "Request indexing" after launch, and again after big changes.
- [ ] Check it monthly: **Performance** (searches and clicks) and **Pages** (anything "not indexed" that should be).

**Bing Webmaster Tools** (Bing's results also power Yahoo and DuckDuckGo):

- [ ] Go to **bing.com/webmasters** → "Import from Google Search Console". It's one click once Google is set up.

## 6. Local listings ("citations")

A handful of accurate listings beats dozens of spammy ones. Same name, phone and website as in section 3, and no address shown.

- [ ] **Apple Business Connect** (businessconnect.apple.com): Apple Maps and Siri.
- [ ] **Bing Places** (bingplaces.com): can import from your Google profile.
- [ ] **Facebook page**: matching details, a link to `/book`.
- [ ] **Yelp** (biz.yelp.ca).
- [ ] **YellowPages.ca**.
- [ ] Wedding and event directories where your clients look, for proposals, bridal showers and engagements (for example WeddingWire.ca). Only if you'd actually take those bookings.
- [ ] Never pay for "100 directory submissions" packages.

## 7. Photo habits (Google reads photos too)

- **Real photos, every time.** Your own setups rank and convert better than stock ones, and
  stock photos of other people's work are misleading.
- **Describe them.** When adding photos to the site, write the description (alt text) the photo
  tool asks for: what's in the picture and the occasion, e.g. *"Proposal picnic with a Marry Me
  sign and rose petals on a lakeside lawn"*. Name a place only if that's truly where it was.
- **File names:** before uploading, renaming `IMG_4821.jpg` to something like
  `proposal-picnic-rose-petals.jpg` helps a little on Google Business Profile and social media.
  On the website the photo tool names files for you.
- **Privacy:** the photo tool strips GPS location from every photo. On Google Business Profile
  and Instagram, turn off location sharing for photos taken at clients' homes.
- **Faces:** ask before posting identifiable clients, always. A table-only shot is often the most beautiful anyway.

## 8. Ideas for future pages (only real ones)

Pages about specific places can rank very well ("proposal picnic at [park]"), **but only write
them about places where you've actually set up**, with your own photos from there. Never claim
to have done something you haven't.

- **Location guides**, after real setups there: what the spot is like, best time of day, where to
  meet, accessibility, and the rules you've confirmed with the city or venue (permits,
  alcohol, confetti). Link each guide to the matching occasion page and `/book`.
- **Real stories**, with the clients' permission: "A sunset proposal by the lake", with photos and
  the details that made it special. No surnames.
- **Seasonal pages** when you really offer them: Valentine's, Mother's Day, summer evenings, autumn setups, indoor winter picnics.
- **Planning help** that answers real client questions: "How to plan a surprise proposal
  picnic", "What to bring to a picnic setup" (spoiler: nothing).

Ask your developer to add new pages with the same structure as the occasion pages, so they
get the right Google markup automatically.

## 9. Every month (15 minutes)

- [ ] 2–4 new photos on Google Business Profile, and a post.
- [ ] Reply to any new reviews.
- [ ] Search Console → Performance: note the top searches. Do the occasion pages answer them?
- [ ] Send review links to last month's clients who haven't reviewed yet (once, never pushy).
