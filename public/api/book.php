<?php
/**
 * Blush Picnic — booking request handler (Hostinger shared hosting, PHP 8.1+).
 *
 * POST the booking form here (urlencoded, multipart or JSON). It validates the answers against
 * ./form-schema.json (built from src/content/booking-form.yaml), emails the request to the
 * business through Hostinger SMTP, and sends the client a confirmation.
 *
 *   fetch() with Accept: application/json → JSON {ok, ref, message} | {ok:false, message, errors}
 *   plain form post (no JS)              → 303 to /thank-you, or /book?error=1
 *
 * Settings and the SMTP password live in blush-config.php OUTSIDE public_html
 * (see api-config/blush-config.example.php). Tests: tests/api-README.md.
 */
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
ini_set('log_errors', '1');
ini_set('html_errors', '0');
error_reporting(E_ALL);
date_default_timezone_set('America/Toronto');
mb_internal_encoding('UTF-8');
ignore_user_abort(true);
@set_time_limit(60);

// In our own code, warnings become exceptions so nothing half-works silently (Handler logs them
// and answers 500). Vendor code (PHPMailer) and deprecations are only logged, never fatal.
set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false; // silenced with @
    }
    $vendor = str_contains(str_replace('\\', '/', $file), '/lib/PHPMailer/');
    if ($vendor || ($severity & (E_DEPRECATED | E_USER_DEPRECATED))) {
        return false; // PHP's normal logging (display_errors is off)
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

require __DIR__ . '/lib/Config.php';
require __DIR__ . '/lib/Http.php';
require __DIR__ . '/lib/FormSchema.php';
require __DIR__ . '/lib/Validator.php';
require __DIR__ . '/lib/Store.php';
require __DIR__ . '/lib/Estimate.php';
require __DIR__ . '/lib/Booking.php';
require __DIR__ . '/lib/Emails.php';
require __DIR__ . '/lib/Mailer.php';
require __DIR__ . '/lib/Handler.php';

(new Blush\Handler(__DIR__))->run();
