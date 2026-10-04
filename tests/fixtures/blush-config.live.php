<?php
// Config for tests/e2e/booking-live.spec.ts ONLY — the real browser form posting to the real
// api/book.php (no route mocking). Never deploy this.
//   BLUSH_CONFIG=$(pwd)/tests/fixtures/blush-config.live.php php -S 127.0.0.1:4506 -t dist-live tests/router.php
// Emails are written as .eml files to tests/.mail-live/ instead of being sent.
declare(strict_types=1);

$tests = dirname(__DIR__);

return [
    'smtp_host' => '127.0.0.1',
    'smtp_port' => 2525,
    'smtp_secure' => '',
    'smtp_username' => 'support@blushpicnic.com',
    'smtp_password' => 'test-password-not-real',

    'from_email' => 'support@blushpicnic.com',
    'from_name' => 'Blush Picnic',
    'to_email' => 'owner-inbox@example.com',
    'reply_to_for_client' => 'owner-replies@example.com',
    'send_client_confirmation' => true,

    'mail_transport' => 'file',
    'mail_dir' => $tests . '/.mail-live',
    'data_dir' => $tests . '/.tmp-live',
    'keep_unsent' => true,

    'rate_limit_max' => 100000,
    'rate_limit_window' => 3600,
    // 0 = the "sent too fast" check is off. Playwright can finish the whole form within a second of
    // opening it; with the check on, those requests would be flagged "[Possible spam]" and get no client
    // confirmation. The spam path is tested on purpose instead (the honeypot test in the spec).
    'min_seconds' => 0,
    'confirm_max_per_hour' => 100000,

    'site_url' => 'https://blushpicnic.com',
    'allowed_origins' => ['https://blushpicnic.com', 'https://www.blushpicnic.com', 'http://127.0.0.1:4506'],
    'allow_localhost' => true,
];
