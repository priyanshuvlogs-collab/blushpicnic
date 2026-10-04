<?php
/**
 * Blush Picnic — booking handler settings (api/book.php).
 *
 * HOW TO INSTALL ON HOSTINGER
 *   1. Copy this file and name the copy  blush-config.php
 *   2. Upload it to the domain folder ABOVE public_html, i.e. next to public_html, not inside it:
 *        /home/<your-user>/domains/blushpicnic.com/blush-config.php
 *        /home/<your-user>/domains/blushpicnic.com/public_html/   ← the website
 *      (hPanel → Files → File Manager → domains → blushpicnic.com). Nothing above public_html can
 *      be opened from a browser, so the password stays private.
 *   3. Put the mailbox password for support@blushpicnic.com in smtp_password below
 *      (hPanel → Emails → support@blushpicnic.com). That is the only value you must fill in.
 *   4. Send a test booking from the website. The request arrives at to_email and the client gets
 *      a confirmation from support@blushpicnic.com.
 *
 * NEVER commit blush-config.php to git (.gitignore already blocks it) and never upload it into
 * public_html. Keep the quotes and the commas at the end of each line.
 *
 * Optional: to keep the file somewhere else, set an environment variable in public_html/.htaccess:
 *   SetEnv BLUSH_CONFIG /home/<your-user>/private/blush-config.php
 */

return [
    // ── Sending mail (Hostinger SMTP) ───────────────────────────────────────
    // Hostinger's outgoing mail server: port 465 with 'ssl' (as listed in hPanel → Emails →
    // Configuration settings). If that port is ever blocked, try 587 with 'tls'.
    'smtp_host' => 'smtp.hostinger.com',
    'smtp_port' => 465,
    'smtp_secure' => 'ssl',               // 'ssl' (port 465) or 'tls' (port 587)

    // The mailbox that sends the emails, and its password. Leave the password empty in git.
    'smtp_username' => 'support@blushpicnic.com',
    'smtp_password' => '',                // ← PASTE THE MAILBOX PASSWORD HERE (on the server only)

    // Who the emails come from. Keep it the same mailbox as smtp_username, so Hostinger accepts the
    // email and inboxes don't flag it as spoofed.
    'from_email' => 'support@blushpicnic.com',
    'from_name' => 'Blush Picnic',

    // Where new booking requests are delivered. "Reply" on those emails goes straight to the client.
    'to_email' => 'blush.picnic25@gmail.com',

    // When a client replies to their confirmation email, the reply goes here.
    'reply_to_for_client' => 'blush.picnic25@gmail.com',

    // Send the client an automatic "we've received your request" email. true = yes, false = no.
    'send_client_confirmation' => true,

    // 'smtp' = really send (use this on the website).
    // 'file' = write each email as an .eml file into mail_dir instead (for testing only).
    'mail_transport' => 'smtp',
    'mail_dir' => '',                     // only used with 'file'; empty = <data_dir>/mail

    // ── Private storage ─────────────────────────────────────────────────────
    // A folder for the rate-limit counter, a monthly activity log (no names, emails or phone
    // numbers — just what happened and the booking reference) and any booking that could not be
    // emailed. Empty = a "blush-data" folder next to public_html, created automatically.
    'data_dir' => '',

    // If an email ever fails to send, keep a copy of the request in <data_dir>/unsent/ so no
    // booking is lost. Open the .eml file with any mail app. Delete them once handled.
    'keep_unsent' => true,

    // ── Spam protection ─────────────────────────────────────────────────────
    // At most this many booking requests per visitor (per internet connection) per window.
    'rate_limit_max' => 5,
    'rate_limit_window' => 3600,          // seconds (3600 = 1 hour)

    // Requests sent faster than this many seconds after the form opened look like bots. Like the
    // other spam checks, that never loses a booking: the request still reaches to_email with
    // "[Possible spam]" in the subject, but the client gets no automatic confirmation.
    'min_seconds' => 4,

    // At most this many client confirmation emails per hour for the whole site (0 = no limit), so
    // the form can never be used to make the mailbox send lots of email. Booking requests to
    // to_email are never held back by this.
    'confirm_max_per_hour' => 20,

    // Only accept submissions from these website addresses. Requests from your own domain are
    // always accepted too, including Hostinger's temporary preview address.
    'site_url' => 'https://blushpicnic.com',
    'allowed_origins' => ['https://blushpicnic.com', 'https://www.blushpicnic.com'],

    // Testing only: also accept http://localhost and http://127.0.0.1. Keep false on the website.
    'allow_localhost' => false,

    // Advanced: only if the site sits behind a proxy/CDN such as Cloudflare, name the header that
    // carries the visitor's real IP (e.g. 'CF-Connecting-IP'), so the rate limit counts visitors,
    // not the CDN. Leave empty on plain Hostinger hosting.
    'client_ip_header' => '',

    // ...and list the proxy's own addresses (single IPs or ranges such as '173.245.48.0/20'; for
    // Cloudflare: https://www.cloudflare.com/ips/). The header is believed only on requests that
    // really come from one of these, because anyone else could make it up.
    'trusted_proxies' => [],
];
