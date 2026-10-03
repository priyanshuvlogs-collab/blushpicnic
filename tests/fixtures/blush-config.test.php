<?php
// Config for tests/api-test.mjs ONLY (php -S with BLUSH_CONFIG pointing here). Never deploy this.
// Emails are written as .eml files to tests/.mail/ instead of being sent. A few TEST_* environment
// variables let the test runner vary one setting per server start (rate limit, failing mail, fake SMTP).
declare(strict_types=1);

$tests = dirname(__DIR__);
$env = static fn (string $k, $default) => ($v = getenv($k)) !== false && $v !== '' ? $v : $default;

return [
    'smtp_host' => $env('TEST_SMTP_HOST', '127.0.0.1'),
    'smtp_port' => (int) $env('TEST_SMTP_PORT', 2525),
    'smtp_secure' => '', // the fake SMTP server in the test speaks plain SMTP
    'smtp_username' => 'support@blushpicnic.com',
    'smtp_password' => 'test-password-not-real',

    'from_email' => 'support@blushpicnic.com',
    'from_name' => 'Blush Picnic',
    'to_email' => 'owner-inbox@example.com',
    'reply_to_for_client' => 'owner-replies@example.com',
    'send_client_confirmation' => true,

    'mail_transport' => $env('TEST_MAIL_TRANSPORT', 'file'),
    'mail_dir' => $env('TEST_MAIL_DIR', $tests . '/.mail'),
    'data_dir' => $tests . '/.tmp',
    'keep_unsent' => true,

    'rate_limit_max' => (int) $env('TEST_RATE_LIMIT_MAX', 100000),
    'rate_limit_window' => 3600,
    'min_seconds' => 1,

    'site_url' => 'https://blushpicnic.com',
    'allowed_origins' => ['https://blushpicnic.com', 'https://www.blushpicnic.com'],
    'allow_localhost' => true,
];
