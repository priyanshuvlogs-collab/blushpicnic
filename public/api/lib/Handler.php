<?php
// The booking request flow, top to bottom:
//   method → config → origin → body → honeypot / time trap → rate limit → validate → email → respond.
declare(strict_types=1);

namespace Blush;

final class Handler
{
    private Log $log;
    private ?Config $config = null;
    /** @var array<string,string> */
    private array $business = [];
    private string $origin = '';

    public function __construct(private readonly string $apiDir)
    {
        $this->log = new Log();
    }

    public function run(): void
    {
        $json = Request::wantsJson();
        try {
            $this->handle($json);
        } catch (HttpError $e) {
            if ($e->logEvent !== '') {
                $this->log->event($e->logEvent, $e->errors ? ['fields' => array_keys($e->errors)] : []);
            }
            $this->fail($json, $e->status, $e->publicMessage, $e->errors, $e->headers);
        } catch (ConfigMissing $e) {
            Log::error($e->getMessage());
            $this->fail($json, 500, $this->sorry());
        } catch (\Throwable $e) {
            Log::error(get_class($e) . ': ' . Mailer::redact($e->getMessage()) . ' @ ' . basename($e->getFile()) . ':' . $e->getLine());
            $this->fail($json, 500, $this->sorry());
        }
    }

    private function handle(bool $json): void
    {
        $method = Request::method();
        if ($method !== 'POST' && $method !== 'OPTIONS') {
            throw new HttpError(405, 'Please use the booking form at /book to send a request.', [], '', ['Allow: POST']);
        }

        $config = $this->config = Config::load($this->apiDir);
        $dataOk = DataDir::ensure($config->str('data_dir'));
        if (!$dataOk) {
            Log::error('data_dir is not writable; rate limiting and logs are off');
        }
        $this->log = new Log($dataOk ? $config->str('data_dir') : '');

        $schema = FormSchema::load($this->apiDir . '/form-schema.json');
        $this->business = $schema->business();

        $this->checkOrigin($config);
        if ($method === 'OPTIONS') {
            $this->preflight();
            return;
        }

        $input = Request::fields();
        $now = time();
        $ipKey = $dataOk ? hash_hmac('sha256', Request::clientIp($config->str('client_ip_header')), DataDir::salt($config->str('data_dir'))) : '';

        // Spam traps: look like success, send nothing.
        if (trim(is_array($input['company_website'] ?? null) ? implode('', $input['company_website']) : (string) ($input['company_website'] ?? '')) !== '') {
            $this->log->event('honeypot', ['ip' => substr($ipKey, 0, 12)]);
            $this->succeed($json, Booking::newRef(new \DateTimeImmutable('now')));
            return;
        }
        if ($this->tooFast($input['_ts'] ?? null, max(0, $config->int('min_seconds')))) {
            $this->log->event('too_fast', ['ip' => substr($ipKey, 0, 12)]);
            $this->succeed($json, Booking::newRef(new \DateTimeImmutable('now')));
            return;
        }

        $limiter = $dataOk
            ? new RateLimiter($config->str('data_dir') . '/rate-limit.json', $config->int('rate_limit_max'), max(60, $config->int('rate_limit_window')))
            : null;
        $wait = $limiter ? $limiter->retryAfter($ipKey, $now) : 0;
        if ($wait > 0) {
            throw new HttpError(
                429,
                sprintf('You’ve sent a few requests in a short time, so we’ve paused new ones for now. Please text us at %s and we’ll take it from there.', $this->business['phoneDisplay']),
                [],
                'rate_limited',
                ['Retry-After: ' . $wait]
            );
        }

        $today = new \DateTimeImmutable('today', new \DateTimeZone(Booking::TZ));
        $result = (new Validator($schema, $today))->validate($input);
        if (!$result->ok()) {
            throw new HttpError(422, 'Please check the highlighted answers.', $result->errors, 'invalid');
        }

        $received = new \DateTimeImmutable('now', new \DateTimeZone(Booking::TZ));
        $booking = new Booking(Booking::newRef($received), $received, $schema, $result);
        $limiter?->hit($ipKey, $now);
        $mailer = new Mailer($config, $this->apiDir . '/lib');
        $logCtx = ['ref' => $booking->ref, 'occasion' => $result->get('occasion'), 'package' => $result->get('package'), 'ip' => substr($ipKey, 0, 12)];

        try {
            $mailer->send(new OutgoingEmail(
                'business',
                $config->str('to_email'),
                $config->str('from_name'),
                $booking->clientEmail(),
                $booking->clientName(),
                $booking->businessSubject(),
                Emails::businessHtml($booking),
                Emails::businessText($booking),
                ['X-Blush-Ref' => $booking->ref],
            ), $booking->ref);
        } catch (\Throwable $e) {
            Log::error('business email failed for ' . $booking->ref . ': ' . Mailer::redact($e->getMessage()));
            $this->log->event('mail_failed', $logCtx);
            throw new HttpError(500, sprintf(
                'We couldn’t send your request just now. Your answers are saved — please try again or text us at %s.',
                $this->business['phoneDisplay']
            ));
        }

        // The client confirmation never blocks success. Where the server allows it, reply first
        // and send it after the visitor already has their answer.
        $confirm = $config->bool('send_client_confirmation');
        $early = $confirm && (function_exists('fastcgi_finish_request') || function_exists('litespeed_finish_request'));
        if ($confirm && !$early) {
            $logCtx['confirmation'] = $this->sendConfirmation($mailer, $booking, $config);
        }
        $this->succeed($json, $booking->ref, $booking->firstName());
        if ($early) {
            function_exists('fastcgi_finish_request') ? fastcgi_finish_request() : litespeed_finish_request();
            $logCtx['confirmation'] = $this->sendConfirmation($mailer, $booking, $config);
        }
        $this->log->event('sent', $logCtx + ['confirmation' => $confirm ? 'sent' : 'off']);
    }

    private function sendConfirmation(Mailer $mailer, Booking $booking, Config $config): string
    {
        try {
            $mailer->send(new OutgoingEmail(
                'client',
                $booking->clientEmail(),
                $booking->clientName(),
                $config->str('reply_to_for_client'),
                $config->str('from_name'),
                $booking->clientSubject(),
                Emails::clientHtml($booking),
                Emails::clientText($booking),
                ['X-Blush-Ref' => $booking->ref, 'Auto-Submitted' => 'auto-generated'],
            ), $booking->ref);
            return 'sent';
        } catch (\Throwable $e) {
            Log::error('client confirmation failed for ' . $booking->ref . ': ' . Mailer::redact($e->getMessage()));
            return 'failed';
        }
    }

    /**
     * _ts = when the form was shown (Unix milliseconds or seconds, from the browser).
     * Submitted sooner than min_seconds → a bot. A clearly negative gap means the visitor's
     * clock runs ahead, which is not their fault, so it is never treated as spam
     * (a couple of seconds of jitter either way still counts as "instant").
     */
    private function tooFast(string|array|null $ts, int $minSeconds): bool
    {
        if (is_array($ts)) {
            $ts = $ts[0] ?? null;
        }
        if ($ts === null || !is_numeric(trim($ts)) || $minSeconds === 0) {
            return false;
        }
        $t = (float) $ts;
        if ($t > 1e11) {
            $t /= 1000;
        }
        $elapsed = microtime(true) - $t;
        return $elapsed > -2.0 && $elapsed < $minSeconds;
    }

    /** Browser posts must come from the site itself (or an allowed origin). Requests without Origin/Referer pass. */
    private function checkOrigin(Config $config): void
    {
        $origin = Request::header('Origin');
        if ($origin === '') {
            $ref = Request::header('Referer');
            if ($ref === '') {
                return;
            }
            $p = parse_url($ref);
            if (!is_array($p) || empty($p['scheme']) || empty($p['host'])) {
                throw new HttpError(403, $this->forbiddenMessage(), [], 'bad_origin');
            }
            $origin = $p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');
        }
        $origin = rtrim(strtolower($origin), '/');

        $allowed = in_array($origin, $config->list('allowed_origins'), true);
        if (!$allowed) {
            // Same host as this request (e.g. Hostinger's preview domain before DNS moves).
            $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
            $allowed = $host !== '' && (parse_url($origin, PHP_URL_HOST) . (parse_url($origin, PHP_URL_PORT) ? ':' . parse_url($origin, PHP_URL_PORT) : '')) === $host;
        }
        if (!$allowed && $config->bool('allow_localhost')) {
            $allowed = (bool) preg_match('#^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$#', $origin);
        }
        if (!$allowed) {
            throw new HttpError(403, $this->forbiddenMessage(), [], 'bad_origin');
        }
        $this->origin = $origin;
    }

    private function preflight(): void
    {
        http_response_code(204);
        Response::baseHeaders();
        $this->corsHeaders();
        header('Access-Control-Allow-Methods: POST');
        header('Access-Control-Allow-Headers: Content-Type, Accept, X-Requested-With');
        header('Access-Control-Max-Age: 600');
    }

    private function corsHeaders(): void
    {
        if ($this->origin !== '' && !headers_sent()) {
            header('Access-Control-Allow-Origin: ' . $this->origin);
            header('Vary: Origin');
        }
    }

    private function succeed(bool $json, string $ref, string $firstName = ''): void
    {
        $this->corsHeaders();
        if (!$json) {
            Response::redirect('/thank-you?ref=' . rawurlencode($ref));
            return;
        }
        $reply = $this->business['replyTime'] ?? 'soon';
        Response::json(200, [
            'ok' => true,
            'ref' => $ref,
            'message' => ($firstName !== '' ? "Thank you, {$firstName} — " : 'Thank you — ') . "we’ve received your request and will reply {$reply}.",
        ]);
    }

    /** @param array<string,string> $errors */
    private function fail(bool $json, int $status, string $message, array $errors = [], array $headers = []): void
    {
        $this->corsHeaders();
        if (!$json && $status !== 405) {
            Response::redirect('/book?error=1#booking-error', $headers);
            return;
        }
        $body = ['ok' => false, 'message' => $message];
        if ($errors) {
            $body['errors'] = $errors;
        }
        Response::json($status, $body, $headers);
    }

    private function sorry(): string
    {
        $phone = $this->business['phoneDisplay'] ?? '';
        if ($phone === '') {
            try {
                $phone = FormSchema::load($this->apiDir . '/form-schema.json')->business()['phoneDisplay'];
            } catch (\Throwable) {
                $phone = '';
            }
        }
        return 'Something went wrong on our side and your request wasn’t sent. Please try again in a moment'
            . ($phone !== '' ? " or text us at {$phone}." : '.');
    }

    private function forbiddenMessage(): string
    {
        return sprintf('We couldn’t accept this request. Please use the booking form on our website, or text us at %s.', $this->business['phoneDisplay'] ?? '');
    }
}
